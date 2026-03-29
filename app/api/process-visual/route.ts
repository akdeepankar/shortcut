import { NextRequest, NextResponse } from 'next/server';
import { updateStatus, initStatus } from '@/lib/status-store';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

interface VisualFrameData {
    timestamp: string;
    timestamp_sec: number;
    description: string;
    objects: string[];
    colors: string[];
    ocr_text: string;
}

export async function POST(request: NextRequest) {
    try {
        const { videoUrl, apiKey: requestApiKey } = await request.json();
        const apiKey = process.env.OPENAI_API_KEY || requestApiKey;

        if (!videoUrl) {
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

        if (!apiKey) {
            return NextResponse.json({ error: 'OpenAI API key is required' }, { status: 400 });
        }

        const processingId = `vis_${Date.now()}`;
        initStatus(processingId);

        // Start async processing
        processVisuals(videoUrl, apiKey, processingId).catch(console.error);

        return NextResponse.json({
            processingId,
            status: 'processing',
            message: 'Visual indexing started'
        });

    } catch (error) {
        console.error('Process visual error:', error);
        return NextResponse.json({ error: 'Failed to start processing' }, { status: 500 });
    }
}

async function processVisuals(videoUrl: string, apiKey: string, processingId: string) {
    const tempDir = path.join(os.tmpdir(), `visuals-${processingId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const ytdlpPath = '/Users/akdeepankar/Library/Python/3.9/bin/yt-dlp';
        const videoFile = path.join(tempDir, 'video.mp4');

        // Step 1: Download Video (low quality for analysis)
        updateStatus(processingId, {
            stage: 'downloading',
            message: 'Downloading video for visual analysis...',
            progress: 10
        });

        // Use robust arguments to avoid 403 Forbidden errors
        const ytdlpArgs = [
            ytdlpPath,
            '-f "bestvideo[height<=360][ext=mp4]/mp4"',
            '--no-playlist',
            '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"',
            '--extractor-args "youtube:player_client=android,web"',
            `-o "${videoFile}"`,
            `"${videoUrl}"`
        ].join(' ');

        await execAsync(ytdlpArgs);

        // Step 2: Extract keyframes every 5 seconds
        updateStatus(processingId, {
            stage: 'extracting',
            message: 'Extracting keyframes every 5 seconds...',
            progress: 30
        });

        const framesDir = path.join(tempDir, 'frames');
        fs.mkdirSync(framesDir, { recursive: true });

        await execAsync(`ffmpeg -i "${videoFile}" -vf "fps=1/5" "${framesDir}/thumb_%04d.jpg"`);

        const frames = fs.readdirSync(framesDir).sort();
        const frameData: VisualFrameData[] = [];

        // Step 3: Analyze frames with GPT-4o Vision
        const openai = new OpenAI({ apiKey });

        updateStatus(processingId, {
            stage: 'analyzing',
            message: `Analyzing ${frames.length} frames with GPT-4o Vision...`,
            progress: 50
        });

        // Process in batches of 4 frames (Vision models have token limits per image)
        const batchSize = 4;
        for (let i = 0; i < frames.length; i += batchSize) {
            const batch = frames.slice(i, i + batchSize);
            const userContent: any[] = [
                {
                    type: "text",
                    text: `Analyze these ${batch.length} video frames. For EACH frame, return a JSON object with:
                    - description: concise scene summary
                    - objects: array of strings
                    - colors: array of strings
                    - ocr_text: any text on screen
                    
                    Return a JSON object with an 'analysis' key containing the array of results.`
                }
            ];

            batch.forEach((frameFile) => {
                const imgBase64 = fs.readFileSync(path.join(framesDir, frameFile)).toString('base64');
                userContent.push({
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${imgBase64}`, detail: "low" }
                });
            });

            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: "You are a multimodal visual analyzer. You output strictly valid JSON arrays of frame analysis objects." },
                    { role: "user", content: userContent }
                ],
                max_tokens: 2000,
                response_format: { type: "json_object" }
            });

            const content = response.choices[0].message.content || '{"analysis": []}';
            console.log(`[Batch ${i}] Vision Response:`, content);

            let batchAnalysis: any[] = [];
            try {
                const parsed = JSON.parse(content);
                // Handle different possible structures
                if (Array.isArray(parsed)) {
                    batchAnalysis = parsed;
                } else if (parsed.analysis && Array.isArray(parsed.analysis)) {
                    batchAnalysis = parsed.analysis;
                } else if (parsed.frames && Array.isArray(parsed.frames)) {
                    batchAnalysis = parsed.frames;
                } else {
                    // Fallback: try to find any array in the object
                    const possibleArray = Object.values(parsed).find(v => Array.isArray(v));
                    if (possibleArray) batchAnalysis = possibleArray as any[];
                }
            } catch (e) {
                console.error("Failed to parse vision response:", e);
            }

            batch.forEach((frameFile, index) => {
                const frameNum = parseInt(frameFile.match(/\d+/)?.[0] || '1');
                const seconds = (frameNum - 1) * 5;
                const analysis = batchAnalysis[index] || { description: "Visual frame", objects: [], colors: [], ocr_text: "" };

                frameData.push({
                    timestamp: formatTime(seconds),
                    timestamp_sec: seconds,
                    description: analysis.description || analysis.text || "Scene detected",
                    objects: analysis.objects || [],
                    colors: analysis.colors || [],
                    ocr_text: analysis.ocr_text || ""
                });
            });

            const progress = 50 + Math.floor(((i + batch.length) / frames.length) * 40);
            updateStatus(processingId, {
                stage: 'analyzing',
                message: `Analyzing visuals... (${i + batch.length}/${frames.length})`,
                progress
            });
        }

        // Step 4: Index in Elasticsearch
        updateStatus(processingId, {
            stage: 'indexing',
            message: 'Indexing hyper-dimensional visual data...',
            progress: 95
        });

        await indexVisuals(frameData, videoUrl);

        updateStatus(processingId, {
            stage: 'complete',
            message: 'Multimodal indexing complete!',
            progress: 100,
            complete: true
        });

    } catch (error) {
        console.error(`[${processingId}] Visual processing failed:`, error);
        updateStatus(processingId, {
            stage: 'error',
            message: 'Visual processing failed',
            progress: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
            complete: false
        });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
    }
}

import { generateEmbeddings, upsertVectors } from '@/lib/cloudflare';

async function indexVisuals(frameData: VisualFrameData[], videoUrl: string) {
    const indexName = 'visual_transcript';
    const uploadDate = new Date().toISOString();
    const videoId = Buffer.from(videoUrl).toString('base64').substring(0, 16);

    // Generate embeddings for all frame descriptions
    const descriptions = frameData.map(d => d.description);
    const embeddings = await generateEmbeddings(descriptions);

    // Prepare vectors for Vectorize
    const vectors = frameData.map((data, idx) => ({
        id: `vis_${videoId}_${idx}`,
        values: embeddings[idx],
        metadata: {
            text: data.description,
            timestamp: data.timestamp,
            timestamp_sec: data.timestamp_sec,
            objects: data.objects.join(', '), // Vectorize metadata works better with strings/numbers
            colors: data.colors.join(', '),
            ocr_text: data.ocr_text,
            filename: videoUrl,
            uploaded_at: uploadDate
        }
    }));

    // Batch upload to Vectorize
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
        await upsertVectors(indexName, vectors.slice(i, i + batchSize));
    }
}


function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = 0;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
