/**
 * Cloudflare Workers AI, Vectorize, and D1 helper
 */

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// Fallback Global Key for troubleshooting auth issues
const CLOUDFLARE_AUTH_EMAIL = process.env.CLOUDFLARE_AUTH_EMAIL;
const CLOUDFLARE_GLOBAL_API_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY;

// D1 Database ID (Durable transcript storage)
const CLOUDFLARE_D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;

// Default model for embeddings (Upgraded to 768-dim HD model)
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5'; 

async function cfFetch(path: string, options: RequestInit = {}, retries = 2): Promise<any> {
    if (!CLOUDFLARE_ACCOUNT_ID) {
        throw new Error('Cloudflare Account ID not found');
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers as any,
    };

    // Determine Auth Scheme
    if (CLOUDFLARE_AUTH_EMAIL && CLOUDFLARE_GLOBAL_API_KEY) {
        headers['X-Auth-Email'] = CLOUDFLARE_AUTH_EMAIL;
        headers['X-Auth-Key'] = CLOUDFLARE_GLOBAL_API_KEY;
    } else if (CLOUDFLARE_API_TOKEN) {
        headers['Authorization'] = `Bearer ${CLOUDFLARE_API_TOKEN}`;
    } else {
        throw new Error('Cloudflare credentials not found (Token or Global Key)');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}${path}`,
            {
                ...options,
                headers,
                signal: controller.signal,
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Cloudflare API Error: ${JSON.stringify(error)}`);
        }

        return response.json();
    } catch (e: any) {
        if ((e.name === 'AbortError' || e.code === 'UND_ERR_CONNECT_TIMEOUT') && retries > 0) {
            console.warn(`[cfFetch] Timeout on ${path}, retrying... (${retries} left)`);
            return cfFetch(path, options, retries - 1);
        }
        throw e;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Auto-Repair wrapper for Vectorize operations
 */
export async function withVectorizeRepair<T>(indexName: string, operation: () => Promise<T>, retries = 3): Promise<T> {
    try {
        return await operation();
    } catch (e: any) {
        const errorMsg = e.message ? e.message.toLowerCase() : String(e).toLowerCase();
        
        // Scenario 1: Index Missing
        const isMissing = errorMsg.includes('40027') || errorMsg.includes('index deleted') || errorMsg.includes('not found');
        
        // Scenario 2: Dimension Mismatch (e.g. expected 768, got 384)
        const isMismatched = errorMsg.includes('40012') || errorMsg.includes('invalid vector') || errorMsg.includes('dimension');

        if (isMissing || isMismatched) {
            console.log(`[Vectorize] Infrastructure Conflict Detected in '${indexName}': ${isMismatched ? 'Dimensional Mismatch (40012)' : 'Missing/Deleted (40027)'}`);
            console.log(`[Vectorize] Triggering ${isMismatched ? 'HARD' : 'AUTO'} Repair sequence...`);
            
            try {
                if (isMismatched) {
                    console.log(`[Vectorize] Terminating old index: ${indexName}...`);
                    await deleteIndex(indexName).catch(() => {}); 
                    // Give Cloudflare ample time to purge the old index name globally
                    console.log(`[Vectorize] Waiting 10s for global purge to complete...`);
                    await new Promise(resolve => setTimeout(resolve, 10000)); 
                }
                
                await createIndex(indexName);
                console.log(`[Vectorize] Index recreated with 768 dimensions (BGE-Base). syncing cluster...`);
                // Final provisioning wait
                await new Promise(resolve => setTimeout(resolve, 5000));
                return await operation(); 
            } catch (repairError: any) {
                console.error(`[Vectorize] FATAL during repair of ${indexName}:`, repairError.message);
                throw repairError;
            }
        }

        if (retries > 0) {
            console.log(`[Vectorize] Operation failed, retrying... (${retries} left)`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return await withVectorizeRepair(indexName, operation, retries - 1);
        }
        throw e;
    }
}

/**
 * Generate embeddings for a given text or array of texts
 */
export async function generateEmbeddings(text: string | string[]) {
    const texts = Array.isArray(text) ? text : [text];
    const batchSize = 50; // Cloudflare Workers AI has internal limits on large payloads
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const result = await cfFetch(`/ai/run/${EMBEDDING_MODEL}`, {
            method: 'POST',
            body: JSON.stringify({ text: batch }),
        });
        
        if (!result.result?.data) {
            console.error('Embedding generation failed for batch:', batch);
            throw new Error(`Embedding Error: ${JSON.stringify(result)}`);
        }
        
        allEmbeddings.push(...result.result.data);
    }

    return allEmbeddings;
}

/**
 * Upsert vectors into a Cloudflare Vectorize index (v2)
 */
export async function upsertVectors(indexName: string, vectors: Array<{ id: string; values: number[]; metadata?: any }>) {
    return cfFetch(`/vectorize/v2/indexes/${indexName}/upsert`, {
        method: 'POST',
        body: JSON.stringify({ vectors }),
    });
}

/**
 * Query a Cloudflare Vectorize index (v2) - Upgraded with Native Binding Support (Worker/Pages)
 */
export async function queryVectors(indexName: string, vector: number[], topK: number = 5, filter?: any, env?: any) {
    // 1. Try Native Worker Binding (Recommended for Production/Speed)
    if (env && env[indexName] && typeof env[indexName].query === 'function') {
        console.log(`[Vectorize] Using Native Binding for query: ${indexName}`);
        try {
            return await env[indexName].query(vector, {
                topK,
                filter,
                returnMetadata: true
            });
        } catch (bindingError: any) {
            console.warn(`[Vectorize] Native binding failed, falling back to REST:`, bindingError.message);
        }
    }

    // 2. Fallback to Cloudflare REST API (Recommended for Local Dev/Next.js)
    const body: any = {
        vector,
        topK,
        return_metadata: true
    };
    if (filter) body.filter = filter;

    return cfFetch(`/vectorize/v2/indexes/${indexName}/query`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/**
 * List all Vectorize indexes (v2)
 */
export async function listIndexes() {
    return cfFetch(`/vectorize/v2/indexes`, {
        method: 'GET'
    });
}

/**
 * List vectors with optional metadata filter (v2) - Upgraded with Pagination Support
 */
export async function listVectors(indexName: string, filter?: any) {
    let allVectors: any[] = [];
    let cursor: string | undefined = undefined;
    
    do {
        let url = `/vectorize/v2/indexes/${indexName}/list?includeMetadata=true`;
        if (filter) {
            const filterStr = encodeURIComponent(JSON.stringify(filter));
            url += `&filter=${filterStr}`;
        }
        if (cursor) {
            url += `&cursor=${cursor}`;
        }
        
        const response = await cfFetch(url, { method: 'GET' });
        if (response.result?.vectors) {
            allVectors.push(...response.result.vectors);
        }
        cursor = response.result?.next_cursor;
    } while (cursor);

    return { result: { vectors: allVectors } };
}

/**
 * Create a new Vectorize index (v2)
 */
export async function createIndex(indexName: string) {
    return cfFetch(`/vectorize/v2/indexes`, {
        method: 'POST',
        body: JSON.stringify({
            name: indexName,
            config: {
                dimensions: 768, // @cf/baai/bge-base-en-v1.5 (Match model output)
                metric: 'cosine'
            }
        })
    });
}

/**
 * Get vectors by their IDs (v2)
 */
export async function getByIds(indexName: string, ids: string[]) {
    return cfFetch(`/vectorize/v2/indexes/${indexName}/get_by_ids`, {
        method: 'POST',
        body: JSON.stringify({ ids })
    });
}

/**
 * Delete vectors by their IDs (v2)
 */
export async function deleteVectors(indexName: string, ids: string[]) {
    return cfFetch(`/vectorize/v2/indexes/${indexName}/delete_by_ids`, {
        method: 'POST',
        body: JSON.stringify({ ids })
    });
}

/**
 * Delete a Vectorize index (v2)
 */
export async function deleteIndex(indexName: string) {
    return cfFetch(`/vectorize/v2/indexes/${indexName}`, {
        method: 'DELETE'
    });
}

/**
 * Clear vectors from an index matching a filter (v2)
 */
export async function clearIndex(indexName: string, filter?: any) {
    const listResult = await listVectors(indexName, filter);
    const ids = (listResult.result.vectors || []).map((v: any) => v.id);
    if (ids.length > 0) {
        // Delete in batches of 1000 (Vectorize limit)
        const batchSize = 1000;
        for (let i = 0; i < ids.length; i += batchSize) {
            await deleteVectors(indexName, ids.slice(i, i + batchSize));
        }
        return { success: true, count: ids.length };
    }
    return { success: true, message: "No matching vectors to clear" };
}

// ═══════════════════════════════════════════════════════════════════
// D1 Database Helpers (Durable Transcript Storage)
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute a D1 SQL query via REST API
 */
export async function d1Query(sql: string, params: any[] = []) {
    if (!CLOUDFLARE_D1_DATABASE_ID) {
        throw new Error('CLOUDFLARE_D1_DATABASE_ID not configured. Run: npm run setup-d1');
    }
    return cfFetch(`/d1/database/${CLOUDFLARE_D1_DATABASE_ID}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql, params }),
    });
}

/**
 * Insert a transcript record into D1
 */
export async function d1InsertTranscript(record: {
    id: string;
    video_id: string;
    text: string;
    type: 'full' | 'segment' | 'visual';
    start_time?: string;
    end_time?: string;
    timestamp_sec?: number;
    objects?: string;
    colors?: string;
    ocr_text?: string;
    user_id?: string;
    video_url?: string;
}) {
    const sql = `INSERT OR REPLACE INTO transcripts 
        (id, video_id, text, type, start_time, end_time, timestamp_sec, objects, colors, ocr_text, user_id, video_url, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
    return d1Query(sql, [
        record.id,
        record.video_id,
        record.text,
        record.type,
        record.start_time || null,
        record.end_time || null,
        record.timestamp_sec ?? null,
        record.objects || null,
        record.colors || null,
        record.ocr_text || null,
        record.user_id || 'global',
        record.video_url || null,
    ]);
}

/**
 * Batch insert transcript records (chunked to avoid D1 limits)
 */
export async function d1InsertTranscriptBatch(records: Parameters<typeof d1InsertTranscript>[0][]) {
    const batchSize = 25; // D1 REST API practical batch limit
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        await Promise.all(batch.map(record => d1InsertTranscript(record)));
    }
}

/**
 * Get all transcripts for a video (by video_id)
 */
export async function d1GetTranscriptsByVideo(videoId: string, userId?: string) {
    let sql = `SELECT * FROM transcripts WHERE video_id = ?`;
    const params: any[] = [videoId];
    if (userId) {
        sql += ` AND user_id = ?`;
        params.push(userId);
    }
    sql += ` ORDER BY timestamp_sec ASC, start_time ASC`;
    return d1Query(sql, params);
}

/**
 * Get transcript records by their IDs (matching Vectorize vector IDs)
 */
export async function d1GetTranscriptsByIds(ids: string[]) {
    if (ids.length === 0) return { result: [{ results: [] }] };
    const placeholders = ids.map(() => '?').join(',');
    const sql = `SELECT * FROM transcripts WHERE id IN (${placeholders}) ORDER BY timestamp_sec ASC, start_time ASC`;
    return d1Query(sql, ids);
}

/**
 * Delete all transcripts for a video
 */
export async function d1DeleteTranscriptsByVideo(videoId: string, userId?: string) {
    let sql = `DELETE FROM transcripts WHERE video_id = ?`;
    const params: any[] = [videoId];
    if (userId) {
        sql += ` AND user_id = ?`;
        params.push(userId);
    }
    return d1Query(sql, params);
}

/**
 * Get all transcripts (for listing/notes view)
 */
export async function d1GetAllTranscripts(userId?: string, type?: string) {
    let sql = `SELECT * FROM transcripts`;
    const conditions: string[] = [];
    const params: any[] = [];
    if (userId) { conditions.push(`user_id = ?`); params.push(userId); }
    if (type) { conditions.push(`type = ?`); params.push(type); }
    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ` ORDER BY uploaded_at DESC`;
    return d1Query(sql, params);
}

/**
 * Initialize D1 database schema (idempotent — safe to call multiple times)
 */
export async function d1InitSchema() {
    const sql = `CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT DEFAULT 'segment',
        start_time TEXT,
        end_time TEXT,
        timestamp_sec REAL,
        objects TEXT,
        colors TEXT,
        ocr_text TEXT,
        user_id TEXT DEFAULT 'global',
        video_url TEXT,
        uploaded_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now'))
    )`;
    const result = await d1Query(sql);
    
    // Create indexes for fast lookups
    await d1Query(`CREATE INDEX IF NOT EXISTS idx_transcripts_video_id ON transcripts(video_id)`);
    await d1Query(`CREATE INDEX IF NOT EXISTS idx_transcripts_user_id ON transcripts(user_id)`);
    await d1Query(`CREATE INDEX IF NOT EXISTS idx_transcripts_type ON transcripts(type)`);
    
    return result;
}

/**
 * Transcribe audio using Whisper (@cf/openai/whisper)
 */
export async function transcribeAudio(audioBuffer: Buffer) {
    const result = await cfFetch('/ai/run/@cf/openai/whisper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(audioBuffer),
    });

    return result.result as { text: string; segments: any[] };
}

/**
 * Classify text sentiment or category (@cf/huggingface/distilbert-sst-2-int8)
 */
export async function classifyText(text: string) {
    const result = await cfFetch('/ai/run/@cf/huggingface/distilbert-sst-2-int8', {
        method: 'POST',
        body: JSON.stringify({ text }),
    });

    return result.result as Array<{ label: string; score: number }>;
}

/**
 * Run chat generation using Cloudflare Workers AI (v1)
 */
export async function runChat(messages: Array<{ role: string; content: string }>) {
    const response = await cfFetch('/ai/run/@cf/meta/llama-3-8b-instruct', {
        method: 'POST',
        body: JSON.stringify({ messages, stream: false }),
    });

    return response.result as { response: string };
}

/**
 * Cloudflare AI Search (formerly AutoRAG) Binding Helpers
 * Note: These require a bound env.AI object on Cloudflare Pages/Workers
 */

interface AISearchOptions {
    query: string;
    model?: string;
    system_prompt?: string;
    rewrite_query?: boolean;
    max_num_results?: number;
    stream?: boolean;
    scaling_options?: { score_threshold: number };
    filters?: any;
}

/**
 * High-performance RAG: Retrieval + Generation in one call
 */
export async function runAISearch(instanceName: string, options: AISearchOptions, env: any) {
    if (!env || !env.AI || !env.AI.autorag) {
        // Fallback for non-binding environments (standard REST API)
        console.warn(`[AI Search] env.AI.autorag not detected. Falling back to REST API for instance: ${instanceName}`);
        
        const result = await cfFetch(`/ai-search/instances/${instanceName}/ai-search`, {
            method: 'POST',
            body: JSON.stringify(options)
        });
        return result.result;
    }

    try {
        // Using the native Workers Binding (v2) as requested
        const aiSearchContext = env.AI.autorag(instanceName);
        return await aiSearchContext.aiSearch(options);
    } catch (e: any) {
        console.error(`AI Search Binding Error (${instanceName}):`, e.message);
        throw e;
    }
}

/**
 * Pure Retrieval: Get relevant results only (no generation)
 */
export async function runAIRetrieval(instanceName: string, query: string, env: any, maxResults: number = 10) {
    if (!env || !env.AI || !env.AI.autorag) {
        const result = await cfFetch(`/ai-search/instances/${instanceName}/search`, {
            method: 'POST',
            body: JSON.stringify({ query, max_num_results: maxResults })
        });
        return result.result;
    }

    const aiSearchContext = env.AI.autorag(instanceName);
    return await aiSearchContext.search({ query, max_num_results: maxResults });
}

/**
 * Classify image (@cf/microsoft/resnet-50)
 */
export async function classifyImage(base64Content: string) {
    const buffer = Buffer.from(base64Content, 'base64');
    const result = await cfFetch('/ai/run/@cf/microsoft/resnet-50', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(buffer),
    });

    return result.result as Array<{ label: string; score: number }>;
}

/**
 * Put object in R2 (Fallback/binding placeholder)
 */
export async function putR2(key: string, data: any) {
    // Log to console for now, as direct REST API for R2 without AWS SDK/binding is limited
    console.log(`[R2] Simulating put to R2 for key: ${key}`);
    return { success: true };
}
