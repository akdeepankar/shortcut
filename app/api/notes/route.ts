import { NextRequest, NextResponse } from 'next/server';
import { d1GetAllTranscripts, d1GetTranscriptsByVideo, d1DeleteTranscriptsByVideo, d1InitSchema } from '@/lib/cloudflare';

/**
 * Notes/Transcripts API — Hono-style CRUD backed by D1
 * 
 * GET  /api/notes              → List all transcripts
 * GET  /api/notes?videoId=xxx  → Get transcripts for a specific video
 * GET  /api/notes?action=init  → Initialize D1 schema (idempotent)
 * DELETE via POST with { action: 'delete', videoId, userId }
 */
export async function GET(request: NextRequest) {
    try {
        const params = request.nextUrl.searchParams;
        const videoId = params.get('videoId');
        const userId = params.get('userId') || undefined;
        const type = params.get('type') || undefined;
        const action = params.get('action');

        // Schema initialization endpoint
        if (action === 'init') {
            const result = await d1InitSchema();
            return NextResponse.json({ success: true, result });
        }

        let result;
        if (videoId) {
            result = await d1GetTranscriptsByVideo(videoId, userId);
        } else {
            result = await d1GetAllTranscripts(userId, type);
        }

        const rows = result.result?.[0]?.results || [];
        return NextResponse.json({ results: rows, count: rows.length });
    } catch (error) {
        console.error('[Notes API] Error:', error);
        return NextResponse.json({
            error: 'Failed to query D1',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { videoId, userId } = await request.json();
        if (!videoId) {
            return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
        }

        const result = await d1DeleteTranscriptsByVideo(videoId, userId);
        return NextResponse.json({ success: true, result });
    } catch (error) {
        console.error('[Notes API] Delete error:', error);
        return NextResponse.json({
            error: 'Failed to delete from D1',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
