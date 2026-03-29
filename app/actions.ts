'use server';

import { askAgent } from '@/lib/agent-client';
import { generateEmbeddings, queryVectors } from '@/lib/cloudflare';

export async function chatWithAgent(query: string, conversationId?: string) {
    // 1. Perform Hybrid Search (Verbal + Visual)
    let extraContext = "";
    try {
        // 1. Generate embedding for the query
        const queryEmbeddings = await generateEmbeddings(query);
        const queryVector = queryEmbeddings[0];

        // 2. Query Vectorize
        const visualSearch = await queryVectors('visual_transcript', queryVector, 5);

        if (visualSearch && visualSearch.result.matches.length > 0) {
            extraContext = "\n\nVISUAL INTELLIGENCE CONTEXT (What is seen in the video):\n";
            visualSearch.result.matches.forEach((match: any) => {
                const s = match.metadata;
                extraContext += `[Time: ${s.timestamp || 'N/A'}] Description: ${s.text}\n`;
                if (s.objects) extraContext += `  - Objects: ${s.objects}\n`;
                if (s.colors) extraContext += `  - Key Colors: ${s.colors}\n`;
                if (s.ocr_text) extraContext += `  - Text on Screen: "${s.ocr_text}"\n`;
                extraContext += "\n";
            });
        }
    } catch (e) {
        console.error("Visual context search failed:", e);
    }

    // 2. Wrap query with visual context if found
    const augmentedQuery = extraContext ?
        `${query}\n\nNote: Use the following visual data to help answer if relevant.${extraContext}` :
        query;

    return await askAgent(augmentedQuery, conversationId);
}

