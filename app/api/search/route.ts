import { NextRequest, NextResponse } from 'next/server';
import { generateEmbeddings, queryVectors, listVectors, getByIds, runAIRetrieval, withVectorizeRepair, d1GetTranscriptsByVideo, d1GetTranscriptsByIds } from '@/lib/cloudflare';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
    const env = (process.env as any);

    try {
        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q') || '';
        const index = searchParams.get('index') || 'transcript';
        const filename = searchParams.get('filename');
        const userId = searchParams.get('userId') || 'global';

        console.log(`[Search] Query: "${query}", Index: "${index}", User: "${userId}", Filename: "${filename}"`);

        // Generate video_id (MD5) consistent with ingestion
        const videoId = filename ? crypto.createHash('md5').update(filename).digest('hex') : undefined;

        console.log(`\n--- [SEARCH FINGERPRINT] ---`);
        console.log(`Source URL: "${filename}"`);
        console.log(`Target MD5 (video_id): "${videoId}"`);
        console.log(`User ID: "${userId}"`);
        console.log(`Index: "${index}"`);
        console.log(`----------------------------\n`);

        // Build Vectorize filter
        const uniqueIds = Array.from(new Set([userId, 'global'])).filter(Boolean);
        const filterClause = uniqueIds.length > 1 ? { $in: uniqueIds } : { $eq: uniqueIds[0] };
        const retrievalFilter: any = { user_id: filterClause };
        if (videoId) retrievalFilter.video_id = { $eq: videoId };

        let results = [];

        if (query) {
            // ═══ Semantic Search: Embed → Vectorize → D1 Enrich ═══
            const queryEmbeddings = await generateEmbeddings(query);
            const queryVector = queryEmbeddings[0];
            const queryResult = await withVectorizeRepair(index, () => queryVectors(index, queryVector, 100, retrievalFilter, env));
            const matches = queryResult.result?.matches || [];

            // Try D1 enrichment for full text
            const matchIds = matches.map((m: any) => m.id).filter(Boolean);
            let d1Records: Record<string, any> = {};
            if (matchIds.length > 0) {
                try {
                    const d1Result = await d1GetTranscriptsByIds(matchIds);
                    const rows = d1Result.result?.[0]?.results || [];
                    rows.forEach((row: any) => { d1Records[row.id] = row; });
                } catch (e) { /* D1 enrichment optional */ }
            }

            results = matches.map((match: any) => {
                const d1Row = d1Records[match.id];
                return {
                    _id: match.id,
                    _source: {
                        ...match.metadata,
                        text: d1Row?.text || match.metadata?.text,
                        start_time: match.metadata?.timestamps?.[0] || d1Row?.start_time,
                        end_time: match.metadata?.timestamps?.[1] || d1Row?.end_time,
                    },
                    score: match.score
                };
            });

        } else if (videoId) {
            // ═══ Listing Mode: Use D1 directly (like reference: SELECT * FROM notes) ═══
            console.log(`[Search] Listing transcripts for video_id: ${videoId} from D1`);

            try {
                const d1Result = await d1GetTranscriptsByVideo(videoId, userId);
                const rows = d1Result.result?.[0]?.results || [];

                if (rows.length > 0) {
                    // Filter by type based on index
                    const typeFilter = index === 'visual_transcript' ? 'visual' : index === 'transcript' ? 'segment' : null;
                    const filtered = typeFilter ? rows.filter((row: any) => row.type === typeFilter) : rows;

                    console.log(`[D1] ✅ Listed ${filtered.length} records (filtered from ${rows.length}) for index: ${index}`);
                    results = filtered.map((row: any) => ({
                        _id: row.id,
                        _source: {
                            text: row.text,
                            type: row.type,
                            start_time: row.start_time,
                            end_time: row.end_time,
                            timestamp_sec: row.timestamp_sec,
                            objects: row.objects,
                            colors: row.colors,
                            ocr_text: row.ocr_text,
                            video_id: row.video_id,
                            user_id: row.user_id,
                            is_full_text: row.type === 'full' ? "true" : "false",
                            timestamps: [row.start_time, row.end_time],
                        },
                        score: 1.0
                    }));
                }
            } catch (d1Err: any) {
                console.warn(`[D1] ⚠️ D1 listing failed, falling back to Vectorize:`, d1Err.message);
            }

            // Fallback: Vectorize zero-vector listing if D1 had no data
            if (results.length === 0) {
                console.log(`[Search] Falling back to Vectorize zero-vector list`);
                const zeroVector = new Array(768).fill(0);
                const queryResult = await withVectorizeRepair(index, () => queryVectors(index, zeroVector, 100, retrievalFilter, env));
                results = (queryResult.result?.matches || []).map((match: any) => ({
                    _id: match.id,
                    _source: {
                        ...match.metadata,
                        start_time: match.metadata?.timestamps?.[0],
                        end_time: match.metadata?.timestamps?.[1]
                    },
                    score: match.score
                }));
            }

            // Chronological sort by timestamp
            results.sort((a: any, b: any) => {
                const secA = Number(a._source.timestamp_sec ?? -1);
                const secB = Number(b._source.timestamp_sec ?? -1);
                if (secA >= 0 && secB >= 0) return secA - secB;
                return (a._source.start_time || '').localeCompare(b._source.start_time || '');
            });
        }

        return NextResponse.json({ results });
    } catch (error) {
        console.error('Search error detail:', error);
        return NextResponse.json({ 
            error: 'Cloudflare search failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
