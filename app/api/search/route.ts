import { NextRequest, NextResponse } from 'next/server';
import { generateEmbeddings, queryVectors } from '@/lib/cloudflare';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q') || '';
        const index = searchParams.get('index') || 'transcript';
        const filename = searchParams.get('filename');

        let results = [];

        if (query) {
            // 1. Generate embedding for the query
            const queryEmbeddings = await generateEmbeddings(query);
            const queryVector = queryEmbeddings[0];

            // 2. Query Vectorize
            // Note: Filter support in Vectorize is currently based on metadata
            const filter = filename ? { filename: filename } : undefined;
            const queryResult = await queryVectors(index, queryVector, 50, filter);

            // 3. Format results to match previous structure
            results = queryResult.result.matches.map((match: any) => ({
                _id: match.id,
                _source: match.metadata,
                score: match.score
            }));
        } else {
            // Cloudflare Vectorize doesn't support match_all easily without a vector.
            // In a real app, you might use a different storage for list/browse.
            return NextResponse.json({ 
                results: [], 
                message: "Cloudflare Vectorize requires a query string for semantic search." 
            });
        }

        return NextResponse.json({ results });
    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ 
            error: 'Cloudflare search failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

