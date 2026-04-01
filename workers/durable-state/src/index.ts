/**
 * Cloudflare Worker: Video Intelligence Orchestrator
 * Architecture: R2 + Vectorize + D1
 */

export interface Env {
    AI: any;
    VECTORIZE: any;
    VIDEO_DB: any;
    VIDEO_BUCKET: any;
    EDITOR_STATE_KV: any;
}

export default {
    async fetch(request: Request, env: Env) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        const url = new URL(request.url);
        if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

        // 1. Route: Ingestion (Start Processing)
        if (url.pathname === '/ingest' && request.method === 'POST') {
            try {
                const { videoUrl, userId } = await request.json() as any;
                const videoId = crypto.randomUUID(); // Session ID

                // Initialize D1 Metadata
                await env.VIDEO_DB.prepare(
                    "INSERT INTO sessions (id, video_url, user_id, status) VALUES (?, ?, ?, ?)"
                ).bind(videoId, videoUrl, userId || "global", "processing").run();

                return new Response(JSON.stringify({ sessionId: videoId }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e: any) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
            }
        }

        // 2. Route: Metadata Retrieval
        if (url.pathname === '/session' && request.method === 'GET') {
            const sessionId = url.searchParams.get("id");
            const session = await env.VIDEO_DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first();
            return new Response(JSON.stringify(session || { error: "Not found" }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // 3. Route: Visual Query (Direct Vectorize)
        if (url.pathname === '/query' && request.method === 'GET') {
            const query = url.searchParams.get("q");
            if (!query) return new Response("Missing query", { status: 400 });

            try {
                const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [query] });
                const results = await env.VECTORIZE.query(embedding.data[0], { topK: 5, returnMetadata: true });
                return new Response(JSON.stringify(results), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e: any) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
            }
        }

        // 4. Default: Session State (KV)
        const sessionId = url.searchParams.get("sessionId") || "default";
        if (request.method === 'GET') {
            const data = await env.EDITOR_STATE_KV.get(sessionId);
            return new Response(data || "{}", { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } else if (request.method === 'POST') {
            const body = await request.json();
            await env.EDITOR_STATE_KV.put(sessionId, JSON.stringify(body));
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
    }
}
