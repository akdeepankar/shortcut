import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const videoUrl = body.videoUrl;
        const startTime = body.startTime;
        const endTime = body.endTime;
        const voiceoverBlocks = Array.isArray(body.voiceoverBlocks) ? body.voiceoverBlocks : [];
        const captionStyles = body.captionStyles || {};
        const showCaptions = !!body.showCaptions;
        const muteOriginal = !!body.muteOriginal;

        if (!videoUrl) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        const isClipping = !!(startTime && endTime);

        // Create temp directory
        const tempDir = path.join(process.cwd(), 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        const timestamp = Date.now();
        const downloadFilename = `full_${timestamp}.mp4`;
        const downloadPath = path.join(tempDir, downloadFilename);
        const outputFilename = isClipping ? `clip_${timestamp}.mp4` : `full_${timestamp}.mp4`;
        const outputPath = path.join(tempDir, outputFilename);

        const ytdlpPath = '/Users/akdeepankar/Library/Python/3.9/bin/yt-dlp';

        // Step 1: Download
        const downloadCommand = `${ytdlpPath} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-playlist --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --extractor-args "youtube:player_client=android" "${videoUrl}" -o "${downloadPath}"`;
        await execAsync(downloadCommand, { maxBuffer: 1024 * 1024 * 500 });

        if (isClipping) {
            const parseTime = (time: string) => {
                const normalized = time.replace(',', '.');
                const parts = normalized.split(':');
                const seconds = parseFloat(parts[parts.length - 1]);
                const minutes = parts.length > 1 ? parseInt(parts[parts.length - 2]) : 0;
                const hours = parts.length > 2 ? parseInt(parts[parts.length - 3]) : 0;
                return hours * 3600 + minutes * 60 + seconds;
            };

            let startSeconds = parseTime(startTime);
            let endSeconds = parseTime(endTime);
            let duration = endSeconds - startSeconds;

            if (duration <= 0.1) {
                startSeconds = Math.max(0, startSeconds - 2);
                duration = 4;
            }

            const toAssTime = (sec: number) => {
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = sec % 60;
                return `${h.toString()}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
            };

            const ffmpegStartTime = `${Math.floor(startSeconds / 3600).toString().padStart(2,'0')}:${Math.floor((startSeconds % 3600)/60).toString().padStart(2,'0')}:${(startSeconds % 60).toFixed(3).padStart(6,'0')}`;

            // Step 2: ASS Generation (Accurate Styling)
            let assPath = "";
            if (showCaptions && voiceoverBlocks && voiceoverBlocks.length > 0) {
                const assFilename = `sub_${timestamp}.ass`;
                assPath = path.join(tempDir, assFilename);
                
                const alignment = captionStyles?.position === 'top' ? 8 : captionStyles?.position === 'center' ? 5 : 2;
                const fontSize = captionStyles?.size === 'xs' ? 24 : captionStyles?.size === 'small' ? 36 : captionStyles?.size === 'large' ? 72 : 48;
                
                const getColor = (c: string) => {
                    switch(c) {
                        case 'amber': return '0B95F5';
                        case 'rose': return '5E3FF4';
                        case 'cyan': return 'EE22D2';
                        default: return 'FFFFFF';
                    }
                };
                
                const activeColor = `&H00${getColor(captionStyles?.color || 'white')}`;
                const inactiveColor = `&H80FFFFFF`;
                const borderStyle = (captionStyles?.theme === 'solid' || captionStyles?.theme === 'glass') ? 3 : 1;
                const backColor = captionStyles?.theme === 'glass' ? '&H90000000' : '&H00000000';

                let assContent = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
                assContent += `Style: Default,Inter,${fontSize},${activeColor},${inactiveColor},&H00000000,${backColor},1,0,0,0,100,100,0,0,${borderStyle},4,0,${alignment},80,80,80,1\n\n`;
                assContent += `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

                voiceoverBlocks.forEach((b: any) => {
                    if (!b.text.trim()) return;
                    const start = toAssTime(b.startTime);
                    const end = toAssTime(b.startTime + (b.duration || 4));
                    let text = b.text.trim();
                    if (captionStyles?.highlight && b.alignment && b.alignment.characters) {
                        const starts = b.alignment.character_start_times_seconds;
                        const words = text.split(/\s+/);
                        let charIdx = 0;
                        let assText = "";
                        words.forEach((word: string) => {
                            const wordStartInBlock = starts[charIdx] || 0;
                            charIdx += word.length + 1;
                            let wordEndInBlock = starts[charIdx] || b.duration || 4;
                            const durationCs = Math.max(1, Math.round((wordEndInBlock - wordStartInBlock) * 100));
                            assText += `{\\k${durationCs}}${word} `;
                        });
                        text = assText.trim();
                    } else {
                        text = text.replace(/\n/g, '\\N');
                    }
                    assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
                });
                await fs.writeFile(assPath, assContent);
            }

            let filterComplex = "";
            let inputs = "";
            const voiceBlocksWithFiles = voiceoverBlocks.filter((b: any) => b.filename);
            
            if (voiceBlocksWithFiles.length > 0) {
                inputs = voiceBlocksWithFiles.map((b: any) => `-i "${path.join(tempDir, b.filename)}"`).join(' ');
                voiceBlocksWithFiles.forEach((b: any, index: number) => {
                    const delay = Math.round(b.startTime * 1000);
                    filterComplex += `[${index + 1}:a]adelay=${delay}|${delay}[a${index + 1}];`;
                });
                const amixInputs = voiceBlocksWithFiles.map((_: any, i: number) => `[a${i + 1}]`).join('');
                if (muteOriginal) {
                    if (voiceBlocksWithFiles.length > 1) {
                        filterComplex += `${amixInputs}amix=inputs=${voiceBlocksWithFiles.length}:duration=first[outa]`;
                    } else {
                        filterComplex += `[a1]acopy[outa]`;
                    }
                } else {
                    filterComplex += `[0:a]${amixInputs}amix=inputs=${voiceBlocksWithFiles.length + 1}:duration=first[outa]`;
                }
            }

            let videoFilter = "";
            if (assPath) {
                const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
                videoFilter = `subtitles='${escapedAssPath}'`;
            }

            let clipCommand: string;
            if (filterComplex || videoFilter || muteOriginal) {
                let mapV = "0:v";
                let mapA = voiceBlocksWithFiles.length > 0 ? "[outa]" : (muteOriginal ? null : "0:a");
                
                if (videoFilter) {
                    filterComplex = (filterComplex ? filterComplex + ";" : "") + `[0:v]${videoFilter}[outv]`;
                    mapV = "[outv]";
                }

                const mapAArg = mapA ? `-map "${mapA}"` : "-an";
                const filterArg = filterComplex ? `-filter_complex "${filterComplex}"` : "";
                clipCommand = `ffmpeg -ss ${ffmpegStartTime} -i "${downloadPath}" ${inputs} -t ${duration.toFixed(3)} ${filterArg} -map "${mapV}" ${mapAArg} -c:v libx264 ${mapA ? '-c:a aac' : ''} -preset fast -crf 22 "${outputPath}"`;
            } else {
                clipCommand = `ffmpeg -ss ${ffmpegStartTime} -i "${downloadPath}" -t ${duration.toFixed(3)} -c:v libx264 -c:a aac -preset fast -crf 22 "${outputPath}"`;
            }

            await execAsync(clipCommand, { maxBuffer: 1024 * 1024 * 100 });

            try {
                await fs.unlink(downloadPath);
                if (assPath) await fs.unlink(assPath);
            } catch (err) {}
        }

        const finalFilename = isClipping ? outputFilename : downloadFilename;
        return NextResponse.json({
            success: true,
            clipUrl: `/api/serve-clip/${finalFilename}`,
            filename: finalFilename
        });

    } catch (error: any) {
        console.error('Video processing error:', error);
        return NextResponse.json({ error: error.message || 'Failed to process video' }, { status: 500 });
    }
}
