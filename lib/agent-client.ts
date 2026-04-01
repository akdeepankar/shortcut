import { runChat } from './cloudflare';

interface AgentResponse {
    reply: string;
    conversation_id: string;
    timestamps?: Array<{ start: string; end: string; text: string }>;
}

export async function askAgent(query: string, history: any[] = []): Promise<AgentResponse | null> {
    try {
        // System prompt for the video assistant
        const systemPrompt = `You are Clipper AI, a professional video intelligence assistant. 
You answer questions about video content by using the transcripts (verbal) and visual insights (what is seen) provided in the context below.

Rules:
1. Ground your answers ONLY in the provided context. If no context is found for a specific query, politely state that you can't find that in the video.
2. NEVER ask the user to provide a transcript or video description if context is already provided.
3. ALWAYS use the provided timestamps (e.g., [00:01:23]) when citing events.
4. If asked about "red tulips" or specific objects, check the VISUAL CONTEXT section thoroughly.
5. Be concise, helpful, and maintain a premium, data-driven tone.`;

        // We use Llama 3 on Cloudflare
        // Inject system prompt first, then history, then current query
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: query }
        ];

        // LOGGING SENT DATA
        console.log('\n--- [LLM REQUEST] ---');
        console.log(JSON.stringify(messages, null, 2));

        const result = await runChat(messages);
        
        // LOGGING RECEIVED DATA
        console.log('--- [LLM RESPONSE] ---');
        console.log(result?.response || 'EMPTY RESPONSE');
        console.log('----------------------\n');

        const reply = result?.response || 'I am sorry, I am having trouble processing that request through Cloudflare AI.';

        // Simple regex to extract common timestamp patterns if the AI generated them but didn't format them
        const timestampRegex = /\[?(\d{2}:\d{2}:\d{2})\]?/g;
        const found = [...reply.matchAll(timestampRegex)];
        const timestamps = found.map(f => ({
            start: f[1],
            end: f[1],
            text: 'Referenced moment'
        }));

        return {
            reply: reply,
            conversation_id: Date.now().toString(),
            timestamps: timestamps.length > 0 ? timestamps : undefined
        };
    } catch (error: any) {
        console.error('Cloudflare Agent Request Failed:', error);
        return {
            reply: `Cloudflare AI Error: ${error.message}. Please check your Cloudflare configuration.`,
            conversation_id: ''
        };
    }
}
