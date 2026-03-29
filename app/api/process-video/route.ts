import { NextRequest, NextResponse } from 'next/server';
import { updateStatus, initStatus } from '@/lib/status-store';
import OpenAI, { toFile } from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

export async function POST(request: NextRequest) {
    try {
        const { videoUrl, apiKey: requestApiKey, engine = 'openai' } = await request.json();

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
        processFastTranscript(videoUrl, apiKey, processingId, engine).catch(console.error);

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

async function processFastTranscript(videoUrl: string, apiKey: string, processingId: string, engine: 'openai' | 'elevenlabs') {
    const tempDir = path.join(os.tmpdir(), `fast-${processingId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const ytdlpPath = '/Users/akdeepankar/Library/Python/3.9/bin/yt-dlp';
        const audioFile = path.join(tempDir, 'audio.mp3');

        updateStatus(processingId, {
            stage: 'downloading',
            message: 'Extracting high-fidelity audio...',
            progress: 20
        });

        const ytdlpArgs = [
            ytdlpPath,
            '-x',
            '--audio-format mp3',
            '--audio-quality 0',
            '--no-playlist',
            '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"',
            '--extractor-args "youtube:player_client=android,web"',
            `-o "${audioFile}"`,
            `"${videoUrl}"`
        ].join(' ');

        await execAsync(ytdlpArgs);

        updateStatus(processingId, {
            stage: 'transcribing',
            message: `Deep listening via ${engine}...`,
            progress: 50
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
            progress: 80
        });

        await indexTranscript(transcript, videoUrl);

        updateStatus(processingId, {
            stage: 'complete',
            message: 'Speech intelligence indexed!',
            progress: 100,
            complete: true
        });

    } catch (error) {
        console.error(`[${processingId}] Fast failed:`, error);
        updateStatus(processingId, {
            stage: 'error',
            message: 'Ingestion failed',
            progress: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
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

    if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);

    const data = await response.json();
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

import { generateEmbeddings, upsertVectors } from '@/lib/cloudflare';

async function indexTranscript(transcript: NormalizedTranscript, videoUrl: string) {
    const indexName = 'transcript';
    const uploadDate = new Date().toISOString();
    const videoId = Buffer.from(videoUrl).toString('base64').substring(0, 16);

    // Prepare all texts for embedding (full text + segments)
    const texts = [transcript.text.trim(), ...transcript.segments.map(s => s.text.trim())];
    const embeddings = await generateEmbeddings(texts);

    const vectors: any[] = [
        {
            id: `full_${videoId}`,
            values: embeddings[0],
            metadata: {
                text: transcript.text.trim(),
                filename: videoUrl,
                uploaded_at: uploadDate,
                is_full_text: "true", // Vectorize metadata works better with strings
                start_time: '00:00:00,000',
                end_time: formatTime(transcript.duration)
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
                start_time: formatTime(segment.start),
                end_time: formatTime(segment.end),
                filename: videoUrl,
                uploaded_at: uploadDate
            }
        });
    });

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
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
