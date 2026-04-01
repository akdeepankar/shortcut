import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
    let openai: OpenAI;
    try {
        // Try to access the service binding / env variable safely
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } catch (e) {
        // Service not available during build
        return new NextResponse('Service not available', { status: 503 });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendProgress = (step: string, progress: number, data?: any) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ step, progress, ...data })}\n\n`));
            };

            const tempDir = path.join(os.tmpdir(), `magic-${Date.now()}`);
            fs.mkdirSync(tempDir, { recursive: true });

            try {
                const { videoUrl, trimStart, trimEnd, prompt } = await request.json();

                if (!videoUrl) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Video URL is required' })}\n\n`));
                    controller.close();
                    return;
                }

                const videoFile = path.join(tempDir, 'source.mp4');
                const audioFile = path.join(tempDir, 'audio.mp3');
                const framesDir = path.join(tempDir, 'frames');
                fs.mkdirSync(framesDir, { recursive: true });

                // Step 1: Extraction
                sendProgress('Downloading High-Fidelity Signal', 10);
                const ytdlpPath = '/Users/akdeepankar/Library/Python/3.9/bin/yt-dlp';
                const commonArgs = [
                    '--no-playlist',
                    '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"',
                    '--extractor-args "youtube:player_client=android,web"',
                    '-f "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]"'
                ];

                try {
                    const ytdlpArgs = [ytdlpPath, ...commonArgs, `--download-sections "*${trimStart}-${trimEnd}"`, `-o "${videoFile}"`, `"${videoUrl}"`].join(' ');
                    await execAsync(ytdlpArgs);
                } catch (e) {
                    const fallbackArgs = [ytdlpPath, ...commonArgs, `-o "${path.join(tempDir, 'full.mp4')}"`, `"${videoUrl}"`].join(' ');
                    await execAsync(fallbackArgs);
                    await execAsync(`ffmpeg -ss ${trimStart} -i "${path.join(tempDir, 'full.mp4')}" -t ${trimEnd - trimStart} -c copy "${videoFile}"`);
                }

                // Step 2: Transcription
                sendProgress('Translating Spectral Audio', 30);
                await execAsync(`ffmpeg -i "${videoFile}" -vn -acodec libmp3lame -q:a 2 "${audioFile}"`);
                const transcription = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(audioFile),
                    model: "whisper-1",
                    response_format: "verbose_json",
                    timestamp_granularities: ["word"]
                });

                // Step 3: Visual Analysis
                sendProgress('Ingesting Multimedia Visuals', 60);
                await execAsync(`ffmpeg -i "${videoFile}" -vf "fps=1/3" "${framesDir}/frame_%04d.jpg"`);
                const frameFiles = fs.readdirSync(framesDir).sort();
                const frameAnalyses: string[] = [];
                const batchSize = 5;
                for (let i = 0; i < frameFiles.length; i += batchSize) {
                    const batch = frameFiles.slice(i, i + batchSize);
                    const userContent: any[] = [{ type: "text", text: "Visual content summary for narration context:" }];
                    batch.forEach(f => {
                        const img = fs.readFileSync(path.join(framesDir, f)).toString('base64');
                        userContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}`, detail: "low" } });
                    });
                    const visionRes = await openai.chat.completions.create({
                        model: "gpt-4o",
                        messages: [{ role: "user", content: userContent }],
                        max_tokens: 300
                    });
                    frameAnalyses.push(visionRes.choices[0].message.content || "");
                }

                // Step 4: Synthesis
                sendProgress('Crafting Multimedia Narrative', 90);
                const totalDuration = trimEnd - trimStart;
                const scriptRes = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [
                        { role: "system", content: `Expert AI Scriptwriter. Create a professional narration script for a ${totalDuration}s video clip. 
                        CRITICAL CONSTRAINTS:
                        1. Return ONLY JSON with a 'blocks' array.
                        2. Each block MUST have: 'startTime' (seconds), 'duration' (seconds), and 'text'.
                        3. STRICTURE: The sum of (startTime + duration) for ANY block MUST NOT exceed ${totalDuration}s.
                        4. The 'startTime' MUST be relative to the clip (starting at 0).
                        5. Ensure text length matches the block duration (average 3 words per second).` },
                        { role: "user", content: `Visual Context: ${frameAnalyses.join('\n')}\nOriginal Transcription (for reference): ${transcription.text}\nDesired Narration Style: ${prompt}\nAvailable Clip Time: 0s to ${totalDuration}s` }
                    ],
                    response_format: { type: "json_object" }
                });

                let parsed = JSON.parse(scriptRes.choices[0].message.content || '{"blocks": []}');
                
                // Final safety clamp to prevent UI overflow
                if (parsed.blocks && Array.isArray(parsed.blocks)) {
                    parsed.blocks = parsed.blocks.map((block: any) => {
                        let start = Math.max(0, parseFloat(block.startTime) || 0);
                        let duration = Math.max(0.5, parseFloat(block.duration) || 2);
                        
                        // If block starts after the clip ends, move it back or discard
                        if (start >= totalDuration) start = Math.max(0, totalDuration - duration);
                        
                        // If duration extends past end, shorten it
                        if (start + duration > totalDuration) {
                            duration = totalDuration - start;
                        }
                        
                        return { ...block, startTime: start, duration: duration };
                    }).filter((b: any) => b.duration > 0.1);
                }

                sendProgress('Finalizing Process', 100, { blocks: parsed.blocks || [] });
                controller.close();

            } catch (error: any) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
                controller.close();
            } finally {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
            }
        }
    });

    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
