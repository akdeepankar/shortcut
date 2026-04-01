import { NextRequest, NextResponse } from 'next/server';
import { generateEmbeddings, queryVectors, withVectorizeRepair, d1GetTranscriptsByIds, d1GetTranscriptsByVideo } from '@/lib/cloudflare';
import crypto from 'crypto';

/**
 * Pure Retrieval API — No LLM, just Vectorize → D1
 * 
 * GET /api/retrieve?q=what+was+said+about+AI&filename=https://youtube.com/watch?v=xxx&userId=global
 * 
 * Returns the matching D1 records (full text, timestamps, objects, etc.)
 */
export async function GET(request: NextRequest) {
    try {
        const params = request.nextUrl.searchParams;
        const query = params.get('q') || '';
        const filename = params.get('filename');
        const userId = params.get('userId') || 'global';
        const topK = parseInt(params.get('topK') || '5');
        const index = params.get('index') || 'all'; // 'transcript' | 'visual_transcript' | 'all'

        // 1. Resolve video identity
        const videoId = filename ? crypto.createHash('md5').update(filename).digest('hex') : undefined;

        console.log(`\n--- [RETRIEVE] ---`);
        console.log(`Query: "${query}"`);
        console.log(`Video ID: "${videoId || 'ALL'}"`);
        console.log(`Index: "${index}", TopK: ${topK}`);
        console.log(`------------------\n`);

        // Build Vectorize filter
        const uniqueIds = Array.from(new Set([userId, 'global'])).filter(Boolean);
        const filterClause = uniqueIds.length > 1 ? { $in: uniqueIds } : { $eq: uniqueIds[0] };
        const retrievalFilter: any = { user_id: filterClause };
        if (videoId) retrievalFilter.video_id = { $eq: videoId };

        // If no query, just list from D1 directly (like SELECT * FROM notes)
        if (!query && videoId) {
            const d1Result = await d1GetTranscriptsByVideo(videoId, userId);
            const rows = d1Result.result?.[0]?.results || [];
            return NextResponse.json({
                source: 'd1_direct',
                query: null,
                video_id: videoId,
                count: rows.length,
                results: rows
            });
        }

        if (!query) {
            return NextResponse.json({ error: 'Provide ?q= for search or ?filename= for listing' }, { status: 400 });
        }

        // 2. Embed the question
        const embeddings = await generateEmbeddings(query);
        const queryVector = embeddings[0];

        // 3. Query Vectorize for matching IDs
        let allMatchIds: string[] = [];
        let vectorizeMatches: any[] = [];

        if (index === 'all' || index === 'transcript') {
            const speechSearch = await withVectorizeRepair('transcript', () =>
                queryVectors('transcript', queryVector, topK, retrievalFilter)
            );
            const matches = speechSearch.result?.matches || [];
            vectorizeMatches.push(...matches.map((m: any) => ({ ...m, _index: 'transcript' })));
            allMatchIds.push(...matches.map((m: any) => m.id));
        }

        if (index === 'all' || index === 'visual_transcript') {
            const visualSearch = await withVectorizeRepair('visual_transcript', () =>
                queryVectors('visual_transcript', queryVector, topK, retrievalFilter)
            );
            const matches = visualSearch.result?.matches || [];
            vectorizeMatches.push(...matches.map((m: any) => ({ ...m, _index: 'visual_transcript' })));
            allMatchIds.push(...matches.map((m: any) => m.id));
        }

        allMatchIds = [...new Set(allMatchIds)].filter(Boolean);

        console.log(`[Vectorize] Found ${allMatchIds.length} matching IDs`);

        // 4. Use IDs → D1 SELECT (like: SELECT * FROM notes WHERE id = ?)
        let results: any[] = [];
        let source = 'vectorize_metadata';

        if (allMatchIds.length > 0) {
            try {
                const d1Result = await d1GetTranscriptsByIds(allMatchIds);
                const rows = d1Result.result?.[0]?.results || [];

                if (rows.length > 0) {
                    source = 'd1';
                    console.log(`[D1] ✅ Retrieved ${rows.length} full records`);

                    // Merge D1 data with Vectorize scores
                    const d1Map: Record<string, any> = {};
                    rows.forEach((row: any) => { d1Map[row.id] = row; });

                    results = vectorizeMatches
                        .filter((m: any) => d1Map[m.id])
                        .map((m: any) => ({
                            ...d1Map[m.id],
                            score: m.score,
                            _index: m._index,
                        }));
                }
            } catch (d1Err: any) {
                console.warn(`[D1] ⚠️ D1 lookup failed:`, d1Err.message);
            }
        }

        // Fallback: return Vectorize metadata if D1 had nothing
        if (results.length === 0 && vectorizeMatches.length > 0) {
            source = 'vectorize_metadata';
            results = vectorizeMatches.map((m: any) => ({
                id: m.id,
                text: m.metadata?.text,
                type: m._index === 'visual_transcript' ? 'visual' : 'segment',
                start_time: m.metadata?.timestamps?.[0],
                end_time: m.metadata?.timestamps?.[1],
                objects: m.metadata?.objects,
                ocr_text: m.metadata?.ocr_text,
                video_id: m.metadata?.video_id,
                user_id: m.metadata?.user_id,
                score: m.score,
                _index: m._index,
            }));
        }

        // Sort by relevance score
        results.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

        return NextResponse.json({
            source,
            query,
            video_id: videoId || null,
            count: results.length,
            results
        });

    } catch (error) {
        console.error('[Retrieve] Error:', error);
        return NextResponse.json({
            error: 'Retrieval failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
