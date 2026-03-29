import { NextRequest, NextResponse } from 'next/server';
import { generateEmbeddings, upsertVectors } from '@/lib/cloudflare';

// Helper to parse SRT format
function parseSRT(srtContent: string) {
    const segments: { start: string; end: string; text: string }[] = [];
    const blocks = srtContent.trim().split(/\n\s*\n/);

    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length < 3) continue;

        const timestampLine = lines[1];
        const textLines = lines.slice(2);

        const timeMatch = timestampLine.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);

        if (timeMatch) {
            segments.push({
                start: timeMatch[1],
                end: timeMatch[2],
                text: textLines.join(' ').trim()
            });
        }
    }
    return segments;
}

const INDEX_NAME = 'transcript';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const content = buffer.toString('utf-8');
        const segments = parseSRT(content);

        if (segments.length === 0) {
            return NextResponse.json({ error: 'Failed to parse SRT or empty file' }, { status: 400 });
        }

        // Generate embeddings for all segments (Workers AI handles batching)
        const texts = segments.map(s => s.text);
        const embeddings = await generateEmbeddings(texts);

        // Prepare vectors for Vectorize
        const vectors = segments.map((segment, i) => ({
            id: `seg_${Date.now()}_${i}`,
            values: embeddings[i],
            metadata: {
                text: segment.text,
                start_time: segment.start,
                end_time: segment.end,
                filename: file.name,
                uploaded_at: new Date().toISOString()
            }
        }));

        // Batch upload to Vectorize (max 100 per call is recommended for reliability, but Cloudflare supports more)
        const batchSize = 100;
        for (let i = 0; i < vectors.length; i += batchSize) {
            await upsertVectors(INDEX_NAME, vectors.slice(i, i + batchSize));
        }

        return NextResponse.json({ success: true, count: segments.length });

    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json({ 
            error: 'Cloudflare Vectorize integration failed', 
            details: error instanceof Error ? error.message : 'Unknown error' 
        }, { status: 500 });
    }
}

