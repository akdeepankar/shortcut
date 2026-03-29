import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
    try {
        const { videoUrl, startTime, endTime } = await request.json();

        if (!videoUrl) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        const isClipping = startTime && endTime;

        // Create temp directory if it doesn't exist
        const tempDir = path.join(process.cwd(), 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        const timestamp = Date.now();
        const downloadFilename = `full_${timestamp}.mp4`;
        const downloadPath = path.join(tempDir, downloadFilename);
        const outputFilename = isClipping ? `clip_${timestamp}.mp4` : `full_${timestamp}.mp4`;
        const outputPath = path.join(tempDir, outputFilename);

        // Use the same yt-dlp path that works in process-video
        const ytdlpPath = '/Users/akdeepankar/Library/Python/3.9/bin/yt-dlp';

        // Step 1: Download the video with yt-dlp
        const downloadCommand = `${ytdlpPath} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-playlist --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" --extractor-args "youtube:player_client=android" "${videoUrl}" -o "${downloadPath}"`;

        console.log(`Downloading ${isClipping ? 'segment source' : 'full video'}...`);
        await execAsync(downloadCommand, {
            maxBuffer: 1024 * 1024 * 500 // 500MB buffer
        });

        // Check if download was successful
        const downloadExists = await fs.access(downloadPath).then(() => true).catch(() => false);
        if (!downloadExists) {
            throw new Error('Failed to download video source');
        }

        if (isClipping) {
            // Step 2: Clip the video with FFmpeg
            const parseTime = (time: string) => {
                const normalized = time.replace(',', '.');
                const parts = normalized.split(':');
                const seconds = parseFloat(parts[parts.length - 1]);
                const minutes = parts.length > 1 ? parseInt(parts[parts.length - 2]) : 0;
                const hours = parts.length > 2 ? parseInt(parts[parts.length - 3]) : 0;
                return hours * 3600 + minutes * 60 + seconds;
            };

            const startSeconds = parseTime(startTime);
            const endSeconds = parseTime(endTime);
            const duration = endSeconds - startSeconds;

            const ffmpegStartTime = startTime.replace(',', '.');

            console.log(`Clipping video from ${startTime} to ${endTime} (${duration.toFixed(3)}s)`);
            const clipCommand = `ffmpeg -ss ${ffmpegStartTime} -i "${downloadPath}" -t ${duration.toFixed(3)} -c:v libx264 -c:a aac -strict experimental "${outputPath}"`;

            await execAsync(clipCommand, {
                maxBuffer: 1024 * 1024 * 100
            });

            // Clean up the downloaded file
            try {
                await fs.unlink(downloadPath);
            } catch (err) {
                console.warn('Failed to delete temporary source file:', err);
            }
        } else {
            // No clipping needed, just use the downloaded file
            // Since we already used downloadPath, we can just point to it or rename it if needed
            // But outputFilename is already set to full_{timestamp}.mp4
        }

        const finalFilename = isClipping ? outputFilename : downloadFilename;
        const videoServedUrl = `/api/serve-clip/${finalFilename}`;

        return NextResponse.json({
            success: true,
            clipUrl: videoServedUrl, // maintain compatibility with existing frontend prop name
            filename: finalFilename,
            isFullVideo: !isClipping
        });

    } catch (error: any) {
        console.error('Video clipping error:', error);

        // Provide more specific error messages
        let errorMessage = 'Failed to clip video';
        if (error.message?.includes('403') || error.message?.includes('Forbidden')) {
            errorMessage = 'YouTube blocked the download. This video may be age-restricted or region-locked.';
        } else if (error.message?.includes('not found')) {
            errorMessage = 'Video not found or unavailable';
        }

        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}
