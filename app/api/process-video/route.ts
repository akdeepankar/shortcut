import { NextRequest, NextResponse } from 'next/server';
import { updateStatus, initStatus } from '@/lib/status-store';
import OpenAI, { toFile } from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { generateEmbeddings, upsertVectors, clearIndex, withVectorizeRepair, d1InsertTranscriptBatch, d1DeleteTranscriptsByVideo } from '@/lib/cloudflare';

const execAsync = promisify(exec);

interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

interface NormalizedTranscript {
    text: string;
    duration: number;
    segments: TranscriptSegment[];
}

interface VisualFrameData {
    start_timestamp: string;
    end_timestamp: string;
    timestamp_sec: number;
    description: string;
    objects: string[];
    colors: string[];
    ocr_text: string;
}

export async function POST(request: NextRequest) {
    try {
        const { videoUrl: rawVideoUrl, apiKey: requestApiKey, engine = 'elevenlabs', userId = 'global' } = await request.json();

        // 1. Unified URL Normalization (Crucial for MD5 consistency)
        const normalizeUrl = (url: string) => {
            try {
                const urlObj = new URL(url);
                const v = urlObj.searchParams.get('v');
                return v ? `${urlObj.origin}${urlObj.pathname}?v=${v}` : url;
            } catch (e) { return url; }
        };
        const videoUrl = normalizeUrl(rawVideoUrl);

        const envKey = engine === 'openai' ? process.env.OPENAI_API_KEY : process.env.ELEVENLABS_API_KEY;
        const apiKey = envKey || requestApiKey;

        if (!videoUrl) {
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

        if (!apiKey) {
            const keyName = engine === 'openai' ? 'OPENAI_API_KEY' : 'ELEVENLABS_API_KEY';
            return NextResponse.json({ error: `${engine} API key is required.` }, { status: 400 });
        }

        const processingId = `proc_${Date.now()}`;
        initStatus(processingId);

        // FOCUS: Fast Audio Analysis
        processFastTranscript(videoUrl, apiKey, processingId, engine, userId).catch(console.error);

        return NextResponse.json({
            processingId,
            status: 'processing',
            message: 'Fast Ingestion started'
        });

    } catch (error) {
        console.error('Process video error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

async function processFastTranscript(videoUrl: string, apiKey: string, processingId: string, engine: 'openai' | 'elevenlabs', userId: string) {
    const tempDir = path.join(os.tmpdir(), `fast-${processingId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        // Step 1: Clear previous embeddings for this user to start fresh
        updateStatus(processingId, { stage: 'downloading', message: 'Readying a fresh workspace...', progress: 5 });
        try {
            console.log(`[Processing] Preparing search indices for User: ${userId}`);
            await withVectorizeRepair('transcript', () => clearIndex('transcript', { user_id: userId }));
            await withVectorizeRepair('visual_transcript', () => clearIndex('visual_transcript', { user_id: userId }));
        } catch (e: any) {
            console.warn(`[Processing] Initial data prep failed (ignoring as long as upserts retry):`, e.message);
        }

        const ytdlpPath = '/Users/akdeepankar/Library/Python/3.9/bin/yt-dlp';
        const videoFile = path.join(tempDir, 'source.mp4');
        const audioFile = path.join(tempDir, 'audio.mp3');

        updateStatus(processingId, {
            stage: 'downloading',
            message: 'Extracting multimedia intelligence...',
            progress: 15
        });

        // OPTIMIZED: Download optimized video source once
        const ytdlpArgs = [
            ytdlpPath,
            '-f "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]"',
            '--no-playlist',
            '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"',
            '--extractor-args "youtube:player_client=android,web"',
            `-o "${videoFile}"`,
            `"${videoUrl}"`
        ].join(' ');

        await execAsync(ytdlpArgs);

        if (!fs.existsSync(videoFile)) {
            throw new Error("Failed to download video source.");
        }

        // Parallel Task 1: Extract Audio
        console.log(`[Processing] Extracting audio from source...`);
        await execAsync(`ffmpeg -i "${videoFile}" -vn -acodec libmp3lame -q:a 2 "${audioFile}"`);

        updateStatus(processingId, {
            stage: 'transcribing',
            message: `Deep listening via ${engine}...`,
            progress: 40
        });

        const audioBuffer = fs.readFileSync(audioFile);
        let transcript: NormalizedTranscript;
        if (engine === 'openai') {
            transcript = await convertToTextOpenAI(audioBuffer, apiKey);
        } else {
            transcript = await convertToTextElevenLabs(audioBuffer, apiKey);
        }

        updateStatus(processingId, {
            stage: 'indexing',
            message: 'Indexing speech intelligence...',
            progress: 70
        });

        await indexTranscript(transcript, videoUrl, userId);

        // Step 4: Visual Analysis (Parallel Task)
        const visionApiKey = engine === 'openai' ? apiKey : process.env.OPENAI_API_KEY;
        if (visionApiKey) {
            updateStatus(processingId, {
                stage: 'analyzing',
                message: 'Analyzing visual intelligence...',
                progress: 80
            });

            await processVisualsInternal(videoUrl, visionApiKey, processingId, tempDir, videoFile, userId);
        }

        updateStatus(processingId, {
            stage: 'complete',
            message: 'Speech & Visual intelligence indexed!',
            progress: 100,
            complete: true
        });

    } catch (error) {
        console.error(`[${processingId}] Processing failed:`, error);
        updateStatus(processingId, {
            stage: 'error',
            message: error instanceof Error ? error.message : 'Ingestion failed',
            progress: 0,
            complete: false
        });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
    }
}

async function convertToTextOpenAI(audioBuffer: Buffer, apiKey: string): Promise<NormalizedTranscript> {
    const openai = new OpenAI({ apiKey });
    const transcription = await openai.audio.transcriptions.create({
        file: await toFile(audioBuffer, 'audio.mp3'),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"]
    });

    return {
        text: transcription.text,
        duration: transcription.duration || 0,
        segments: (transcription as any).segments?.map((s: any) => ({
            start: s.start,
            end: s.end,
            text: s.text
        })) || []
    };
}

async function convertToTextElevenLabs(audioBuffer: Buffer, apiKey: string): Promise<NormalizedTranscript> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' });
    formData.append('file', blob, 'audio.mp3');
    formData.append('model_id', 'scribe_v2');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData
    });

    if (!response.ok) {
        const errorDetail = await response.text();
        throw new Error(`ElevenLabs error (${response.status}): ${errorDetail}`);
    }

    const data = await response.json();
    console.log(`\n--- [ELEVENLABS SCRIBE RAW RESPONSE] ---`);
    console.log(JSON.stringify(data, null, 2));
    console.log(`----------------------------------------\n`);
    console.log(`[ElevenLabs] Transcription successful. Length: ${data.text?.length || 0}`);
    
    // ElevenLabs STT response structure uses 'words' array
    const rawItems = data.words || [];
    const segments: TranscriptSegment[] = [];
    let currentGroup: any[] = [];

    for (const item of rawItems) {
        currentGroup.push(item);
        if ((item.type === 'word' && /[.!?]$/.test(item.text.trim())) || currentGroup.filter(i => i.type === 'word').length >= 25) {
            const groupWords = currentGroup.filter(i => i.type === 'word');
            if (groupWords.length > 0) {
                segments.push({
                    start: groupWords[0].start,
                    end: groupWords[groupWords.length - 1].end,
                    text: currentGroup.map(i => i.text).join('').trim()
                });
            }
            currentGroup = [];
        }
    }

    return {
        text: data.text || segments.map(s => s.text).join(' '),
        duration: rawItems.length > 0 ? rawItems[rawItems.length - 1].end : 0,
        segments
    };
}


async function indexTranscript(transcript: NormalizedTranscript, videoUrl: string, userId: string) {
    const indexName = 'transcript';
    const uploadDate = new Date().toISOString();
    const videoId = crypto.createHash('md5').update(videoUrl).digest('hex');

    console.log(`\n--- [TRANSCRIPT FINGERPRINT] ---`);
    console.log(`Source URL: "${videoUrl}"`);
    console.log(`Generated Video ID (MD5): "${videoId}"`);
    console.log(`User ID: "${userId}"`);
    console.log(`----------------------------\n`);

    console.log(`[Indexing] Initializing transcript vectors for: ${videoUrl} (User: ${userId})`);
    const texts = [transcript.text.trim(), ...transcript.segments.map(s => s.text.trim())];
    
    try {
        // ═══ STEP 1: Persist to D1 (Durable Source of Truth) ═══
        try {
            console.log(`[D1] Clearing previous records for video: ${videoId}`);
            await d1DeleteTranscriptsByVideo(videoId, userId);

            const d1Records: Parameters<typeof d1InsertTranscriptBatch>[0] = [
                {
                    id: `full_${videoId}`,
                    video_id: videoId,
                    text: transcript.text.trim(),
                    type: 'full' as const,
                    start_time: '00:00:00,000',
                    end_time: formatTime(transcript.duration),
                    timestamp_sec: 0,
                    user_id: userId,
                    video_url: videoUrl,
                },
                ...transcript.segments.map((segment, idx) => ({
                    id: `seg_${videoId}_${idx}`,
                    video_id: videoId,
                    text: segment.text.trim(),
                    type: 'segment' as const,
                    start_time: formatTime(segment.start),
                    end_time: formatTime(segment.end),
                    timestamp_sec: segment.start,
                    user_id: userId,
                    video_url: videoUrl,
                }))
            ];

            await d1InsertTranscriptBatch(d1Records);
            console.log(`[D1] ✅ Persisted ${d1Records.length} transcript records (1 full + ${transcript.segments.length} segments)`);
        } catch (d1Err: any) {
            console.warn(`[D1] ⚠️ D1 persistence failed (continuing with Vectorize-only):`, d1Err.message);
        }

        // ═══ STEP 2: Generate Embeddings & Upsert to Vectorize ═══
        const embeddings = await generateEmbeddings(texts);
        if (!embeddings || embeddings.length === 0) throw new Error("No embeddings generated for transcript.");

        const vectors: any[] = [
            {
                id: `full_${videoId}`,
                values: embeddings[0],
                metadata: {
                    text: transcript.text.trim(),
                    video_id: videoId,
                    uploaded_at: String(uploadDate),
                    user_id: String(userId),
                    is_full_text: "true",
                    timestamps: ["00:00:00,000", formatTime(transcript.duration)],
                    segment_id: `full_${videoId}`,
                    topics: "[]",
                    speakers: "[]"
                }
            }
        ];

        transcript.segments.forEach((segment, idx) => {
            vectors.push({
                id: `seg_${videoId}_${idx}`,
                values: embeddings[idx + 1],
                metadata: {
                    text: segment.text.trim(),
                    is_full_text: "false",
                    timestamps: [formatTime(segment.start), formatTime(segment.end)],
                    video_id: videoId,
                    segment_id: `seg_${videoId}_${idx}`,
                    uploaded_at: String(uploadDate),
                    user_id: String(userId),
                    topics: "[]",
                    speakers: "[]"
                }
            });
        });

        const batchSize = 100;
        for (let i = 0; i < vectors.length; i += batchSize) {
            const batch = vectors.slice(i, i + batchSize);
            console.log(`[Indexing] Upserting transcript batch ${i / batchSize + 1} (${batch.length} vectors) to ${indexName}...`);
            const result = await withVectorizeRepair(indexName, () => upsertVectors(indexName, batch));
            if (!result.success) throw new Error(`Vectorize upsert failed: ${JSON.stringify(result)}`);
        }
    } catch (err: any) {
        console.error(`[Indexing] Transcript indexing FAILED:`, err.message);
        throw err;
    }
}

async function processVisualsInternal(videoUrl: string, apiKey: string, processingId: string, tempDir: string, videoFile: string, userId: string) {
    try {
        const framesDir = path.join(tempDir, 'frames');
        if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

        // Extract keyframes every 5 seconds (optimal balance of speed vs detail)
        console.log(`[Processing] Extracting frames from ${videoFile}...`);
        await execAsync(`ffmpeg -i "${videoFile}" -vf "fps=1/5" "${framesDir}/thumb_%04d.jpg"`);

        const frames = fs.readdirSync(framesDir).sort();
        const frameData: VisualFrameData[] = [];
        const openai = new OpenAI({ apiKey });

        // Process in batches
        const batchSize = 4;
        for (let i = 0; i < frames.length; i += batchSize) {
            const batch = frames.slice(i, i + batchSize);
            const userContent: any[] = [
                {
                    type: "text",
                    text: `Analyze these ${batch.length} video frames. For EACH frame, return JSON: {description, objects: [], colors: [], ocr_text}. Return array in 'analysis' key.`
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
                    { role: "system", content: "Multimodal visual analyzer. STRICT JSON." },
                    { role: "user", content: userContent }
                ],
                response_format: { type: "json_object" }
            });

            const content = response.choices[0].message.content || '{"analysis": []}';
            let batchAnalysis: any[] = [];
            try {
                const parsed = JSON.parse(content);
                batchAnalysis = parsed.analysis || parsed.frames || Object.values(parsed).find(v => Array.isArray(v)) || [];
            } catch (e) { }

            batch.forEach((frameFile, index) => {
                const frameNum = parseInt(frameFile.match(/\d+/)?.[0] || '1');
                const seconds = (frameNum - 1) * 5; // fps=1/5
                const analysis = batchAnalysis[index] || { description: "Visual frame", objects: [], colors: [], ocr_text: "" };

                frameData.push({
                    start_timestamp: formatTime(seconds),
                    end_timestamp: formatTime(seconds + 5),
                    timestamp_sec: seconds,
                    description: analysis.description || "Scene detected",
                    objects: analysis.objects || [],
                    colors: analysis.colors || [],
                    ocr_text: analysis.ocr_text || ""
                });
            });

            updateStatus(processingId, {
                stage: 'analyzing',
                message: `Analyzing visuals... (${Math.min(i + batch.length, frames.length)}/${frames.length})`,
                progress: 85 + Math.floor(((i + batch.length) / frames.length) * 10)
            });
        }

        await indexVisuals(frameData, videoUrl, userId);

    } catch (error) {
        console.error("Auto visual processing failed:", error);
        // Don't fail the whole process if visual analysis fails, but log it
    }
}

async function indexVisuals(frameData: VisualFrameData[], videoUrl: string, userId: string) {
    const indexName = 'visual_transcript';
    const uploadDate = new Date().toISOString();
    const videoId = crypto.createHash('md5').update(videoUrl).digest('hex');

    console.log(`[Indexing] Initializing visual vectors for: ${videoUrl} (User: ${userId}, Frames: ${frameData.length})`);

    if (frameData.length === 0) {
        console.warn(`[Indexing] Skipping visual indexing: No frame data available.`);
        return;
    }

    try {
        // ═══ STEP 1: Persist visual data to D1 ═══
        try {
            const d1Records = frameData.map((data, idx) => ({
                id: `vis_${videoId}_${idx}`,
                video_id: videoId,
                text: data.description,
                type: 'visual' as const,
                start_time: String(data.start_timestamp),
                end_time: String(data.end_timestamp),
                timestamp_sec: data.timestamp_sec,
                objects: data.objects?.join(', ') || '',
                colors: data.colors?.join(', ') || '',
                ocr_text: data.ocr_text || '',
                user_id: userId,
                video_url: videoUrl,
            }));

            await d1InsertTranscriptBatch(d1Records);
            console.log(`[D1] ✅ Persisted ${d1Records.length} visual frame records`);
        } catch (d1Err: any) {
            console.warn(`[D1] ⚠️ Visual D1 persistence failed (continuing with Vectorize-only):`, d1Err.message);
        }

        // ═══ STEP 2: Generate Embeddings & Upsert to Vectorize ═══
        // Create composite searchable strings for richer semantic vectors
        const compositeTexts = frameData.map(d => {
            const parts = [
                d.description,
                d.objects?.length ? `Objects: ${d.objects.join(', ')}` : '',
                d.colors?.length ? `Colors: ${d.colors.join(', ')}` : '',
                d.ocr_text ? `Text Found: ${d.ocr_text}` : ''
            ].filter(Boolean);
            return parts.join(' | ');
        });

        const embeddings = await generateEmbeddings(compositeTexts);
        
        if (!embeddings || embeddings.length === 0) throw new Error("No embeddings generated for visual descriptions.");

        const vectors = frameData.map((data, idx) => ({
            id: `vis_${videoId}_${idx}`,
            values: embeddings[idx],
            metadata: {
                text: data.description,
                timestamps: [String(data.start_timestamp), String(data.end_timestamp)],
                timestamp_sec: Number(data.timestamp_sec),
                objects: String(data.objects?.join(', ') || ""),
                colors: String(data.colors?.join(', ') || ""),
                ocr_text: String(data.ocr_text || ""),
                video_id: videoId,
                segment_id: `vis_${videoId}_${idx}`,
                uploaded_at: String(uploadDate),
                user_id: String(userId),
                topics: "[]",
                speakers: "[]"
            }
        }));

        const batchSize = 100;
        for (let i = 0; i < vectors.length; i += batchSize) {
            const batch = vectors.slice(i, i + batchSize);
            console.log(`[Indexing] Upserting visual batch ${i / batchSize + 1} (${batch.length} vectors) to ${indexName}...`);
            const result = await withVectorizeRepair(indexName, () => upsertVectors(indexName, batch));
            if (!result.success) throw new Error(`Vectorize upsert failed: ${JSON.stringify(result)}`);
        }
        console.log(`[Indexing] Visual indexing complete for user: ${userId}`);
    } catch (err: any) {
        console.error(`[Indexing] Visual indexing FAILED:`, err.message);
        throw err;
    }
}

function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
