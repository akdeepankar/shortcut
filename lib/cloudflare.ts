/**
 * Cloudflare Workers AI and Vectorize helper
 */

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// Default model for embeddings
const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5'; 

async function cfFetch(path: string, options: RequestInit = {}) {
    if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
        throw new Error('Cloudflare credentials not found');
    }

    const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}${path}`,
        {
            ...options,
            headers: {
                'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json',
                ...options.headers,
            },
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Cloudflare API Error: ${JSON.stringify(error)}`);
    }

    return response.json();
}

/**
 * Generate embeddings for a given text or array of texts
 */
export async function generateEmbeddings(text: string | string[]) {
    const texts = Array.isArray(text) ? text : [text];
    
    // Workers AI run
    const result = await cfFetch(`/ai/run/${EMBEDDING_MODEL}`, {
        method: 'POST',
        body: JSON.stringify({ text: texts }),
    });

    return result.result.data as number[][];
}

/**
 * Upsert vectors into a Cloudflare Vectorize index
 */
export async function upsertVectors(indexName: string, vectors: Array<{ id: string; values: number[]; metadata?: any }>) {
    return cfFetch(`/vectorize/v1/indexes/${indexName}/upsert`, {
        method: 'POST',
        body: JSON.stringify({ vectors }),
    });
}

/**
 * Query a Cloudflare Vectorize index
 */
export async function queryVectors(indexName: string, vector: number[], topK: number = 5, filter?: any) {
    return cfFetch(`/vectorize/v1/indexes/${indexName}/query`, {
        method: 'POST',
        body: JSON.stringify({
            vector,
            topK,
            filter,
            returnMetadata: true
        }),
    });
}

/**
 * List all Vectorize indexes
 */
export async function listIndexes() {
    return cfFetch(`/vectorize/v1/indexes`, {
        method: 'GET'
    });
}

/**
 * Delete a Vectorize index
 */
export async function deleteIndex(indexName: string) {
    return cfFetch(`/vectorize/v1/indexes/${indexName}`, {
        method: 'DELETE'
    });
}

/**
 * Transcribe audio using Whisper (@cf/openai/whisper)
 */
export async function transcribeAudio(audioBuffer: Buffer) {
    // Workers AI run
    const result = await cfFetch('/ai/run/@cf/openai/whisper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(audioBuffer),
    });

    return result.result as { text: string; segments: any[] };
}

/**
 * Classify image objects (@cf/microsoft/resnet-50)
 */
export async function classifyImage(imageBase64: string) {
    const buffer = Buffer.from(imageBase64, 'base64');
    
    const result = await cfFetch('/ai/run/@cf/microsoft/resnet-50', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(buffer),
    });

    return result.result as Array<{ label: string; score: number }>;
}
