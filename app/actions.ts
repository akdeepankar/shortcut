'use server';

import OpenAI from 'openai';
import { generateEmbeddings, queryVectors, withVectorizeRepair, d1GetTranscriptsByIds, d1Query } from '@/lib/cloudflare';
import crypto from 'crypto';

export async function chatWithAgent(query: string, conversationId?: string, userId: string = 'global', videoUrl?: string) {

    // 1. Resolve Video Identity
    let normalizedVideoUrl = videoUrl;
    if (videoUrl) {
        try {
            const urlObj = new URL(videoUrl);
            normalizedVideoUrl = `${urlObj.origin}${urlObj.pathname}?v=${urlObj.searchParams.get('v')}`;
        } catch (e) {}
    }

    const videoId = normalizedVideoUrl ? crypto.createHash('md5').update(normalizedVideoUrl).digest('hex') : undefined;

    const uniqueIds = Array.from(new Set([userId, 'global'])).filter(Boolean);
    const filterClause = uniqueIds.length > 1 ? { $in: uniqueIds } : { $eq: uniqueIds[0] };
    const retrievalFilter: any = { user_id: filterClause };
    if (videoId) retrievalFilter.video_id = { $eq: videoId };

    let notes: string[] = [];

    // ═══ STEP 1: Retrieve from D1 (via Vectorize or keyword fallback) ═══

    // Path A: Semantic search — Embed → Vectorize → D1 by IDs
    try {
        const embeddings = await generateEmbeddings(query);
        const queryVector = embeddings[0];

        const [speechSearch, visualSearch] = await Promise.all([
            withVectorizeRepair('transcript', () => queryVectors('transcript', queryVector, 5, retrievalFilter)),
            withVectorizeRepair('visual_transcript', () => queryVectors('visual_transcript', queryVector, 5, retrievalFilter)),
        ]);

        const speechMatches = speechSearch.result?.matches || [];
        const visualMatches = visualSearch.result?.matches || [];

        const allMatchIds = [
            ...speechMatches.map((m: any) => m.id),
            ...visualMatches.map((m: any) => m.id),
        ].filter(Boolean);

        if (allMatchIds.length > 0) {
            const d1Result = await d1GetTranscriptsByIds(allMatchIds);
            const rows = d1Result.result?.[0]?.results || [];
            notes = rows
                .filter((row: any) => row.type !== 'full')
                .map((row: any) => formatRow(row));
        }
    } catch (e: any) {
        console.error("[Retrieval] Vectorize path failed:", e.message);
    }

    // Path B: Keyword fallback — extract words → D1 LIKE search
    if (notes.length === 0) {
        try {
            const stopWords = new Set([
                'a','an','the','is','are','was','were','be','been','being',
                'have','has','had','do','does','did','will','would','could','should',
                'may','might','shall','can','need','dare','ought','used','to',
                'of','in','for','on','with','at','by','from','as','into','through',
                'during','before','after','above','below','between','out','off',
                'over','under','again','further','then','once','here','there',
                'when','where','why','how','all','both','each','few','more',
                'most','other','some','such','no','nor','not','only','own',
                'same','so','than','too','very','just','about','up','down',
                'and','but','or','if','while','what','which','who','whom',
                'this','that','these','those','i','me','my','we','our','you',
                'your','he','him','his','she','her','it','its','they','them',
                'show','find','tell','give','get','see','look','search','display',
            ]);

            const keywords = query
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 2 && !stopWords.has(w));

            if (keywords.length > 0) {
                const conditions = keywords.map(() => `text LIKE ?`).join(' OR ');
                const params: any[] = keywords.map(k => `%${k}%`);

                let sql = `SELECT * FROM transcripts WHERE type != 'full' AND (${conditions})`;
                if (videoId) {
                    sql += ` AND video_id = ?`;
                    params.push(videoId);
                }
                sql += ` ORDER BY timestamp_sec ASC LIMIT 10`;

                const d1Result = await d1Query(sql, params);
                const rows = d1Result.result?.[0]?.results || [];
                console.log(`[D1] Keywords [${keywords.join(', ')}] → ${rows.length} matches`);
                notes = rows.map((row: any) => formatRow(row));
            }
        } catch (d1Err: any) {
            console.error("[D1] Keyword search failed:", d1Err.message);
        }
    }

    // ═══ STEP 2: Pass raw D1 results to LLM to craft a reply with timestamps ═══
    if (notes.length === 0) {
        return {
            reply: "No matching content found for this query.",
            conversation_id: conversationId || Date.now().toString(),
        };
    }

    const context = notes.map(note => `- ${note}`).join("\n");

    console.log(`\n--- [LLM] ---`);
    console.log(`Query: "${query}"`);
    console.log(`Context items: ${notes.length}`);
    console.log(`-------------\n`);

    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a video assistant. The user asked a question about a video. Below are the raw search results from the video's transcript and visual analysis, each with a timestamp.

Your job:
1. Read the raw results and answer the user's question naturally.
2. ALWAYS include the timestamps (e.g. 00:00:15,000 to 00:00:20,000) so the user can jump to that moment.
3. Be concise. Don't repeat data, just highlight what's relevant to their question.

Raw results:
${context}`
                },
                { role: 'user', content: query }
            ],
            max_tokens: 512,
        });

        const reply = completion.choices[0]?.message?.content || 'Could not generate a response.';

        return {
            reply,
            conversation_id: conversationId || Date.now().toString(),
        };

    } catch (llmErr: any) {
        console.error("[LLM] OpenAI failed:", llmErr.message);
        // If LLM fails, return raw results directly
        return {
            reply: context,
            conversation_id: conversationId || Date.now().toString(),
        };
    }
}

function formatRow(row: any): string {
    if (row.type === 'visual') {
        let line = `[${row.start_time || ''} to ${row.end_time || ''}] ${row.text}`;
        if (row.objects) line += ` | Objects: ${row.objects}`;
        if (row.ocr_text) line += ` | Screen Text: "${row.ocr_text}"`;
        return line;
    }
    return `[${row.start_time || ''} to ${row.end_time || ''}] "${row.text}"`;
}
