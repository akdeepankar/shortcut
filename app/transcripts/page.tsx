import ProcessForm from '@/app/transcripts/process-form';
import TranscriptsClient from '@/app/transcripts/transcripts-client';
import { d1GetTranscriptsByVideo, generateEmbeddings, queryVectors, withVectorizeRepair } from '@/lib/cloudflare';
import { chatWithAgent } from '@/app/actions';
import crypto from 'crypto';

interface TranscriptDoc {
    text: string;
    start_time: string;
    end_time: string;
    filename: string;
    uploaded_at: string;
    is_full_text?: boolean;
    type?: string;
}

interface SearchResult {
    _id: string;
    _source: TranscriptDoc;
    score: number;
}

export default async function TranscriptsPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; url?: string; userId?: string }>;
}) {
    const resolvedSearchParams = await searchParams;
    const query = resolvedSearchParams?.q || '';
    const rawUrl = resolvedSearchParams?.url || '';
    const userId = resolvedSearchParams?.userId || 'global';

    const normalizeUrl = (u: string) => {
        if (!u) return '';
        try {
            const urlObj = new URL(u);
            const v = urlObj.searchParams.get('v');
            return v ? `${urlObj.origin}${urlObj.pathname}?v=${v}` : u;
        } catch (e) { return u; }
    };
    const url = normalizeUrl(rawUrl);

    let allTranscripts: SearchResult[] = [];
    let agentResponse: string | null = null;

    try {
        if (query) {
            const agentResult = await chatWithAgent(query, undefined, userId, url);
            if (agentResult && !('error' in agentResult)) {
                agentResponse = agentResult.reply || null;
            }
        }

        if (url) {
            // ═══ Load ALL records from D1 (speech segments + visual + full text) ═══
            const videoId = crypto.createHash('md5').update(url).digest('hex');

            console.log(`\n--- [SSR FINGERPRINT] ---`);
            console.log(`Source URL: "${url}"`);
            console.log(`Video ID: "${videoId}", User: "${userId}"`);
            console.log(`-------------------------\n`);

            try {
                const d1Result = await d1GetTranscriptsByVideo(videoId, userId);
                const rows = d1Result.result?.[0]?.results || [];

                if (rows.length > 0) {
                    console.log(`[D1] ✅ Loaded ${rows.length} records from D1`);

                    // Split each record at sentence boundaries (each full stop = one card)
                    for (const row of rows) {
                        if (row.type === 'full') {
                            // Full transcript → mark as is_full_text
                            allTranscripts.push({
                                _id: row.id,
                                _source: {
                                    text: row.text,
                                    start_time: row.start_time,
                                    end_time: row.end_time,
                                    filename: row.video_url || url,
                                    uploaded_at: row.uploaded_at || '',
                                    is_full_text: true,
                                    type: 'full',
                                },
                                score: 1.0
                            });
                        } else if (row.type === 'segment') {
                            // Split speech segments by sentence (. ! ?)
                            const sentences = splitIntoSentences(row.text);
                            const startSec = row.timestamp_sec || 0;
                            const endSec = parseTimestampToSec(row.end_time);
                            const totalDuration = endSec - startSec;

                            sentences.forEach((sentence: string, i: number) => {
                                // Interpolate timestamp proportionally within the segment
                                const ratio = sentences.length > 1 ? i / sentences.length : 0;
                                const endRatio = sentences.length > 1 ? (i + 1) / sentences.length : 1;
                                const sentStart = startSec + totalDuration * ratio;
                                const sentEnd = startSec + totalDuration * endRatio;

                                allTranscripts.push({
                                    _id: `${row.id}_s${i}`,
                                    _source: {
                                        text: sentence.trim(),
                                        start_time: formatSec(sentStart),
                                        end_time: formatSec(sentEnd),
                                        filename: row.video_url || url,
                                        uploaded_at: row.uploaded_at || '',
                                        is_full_text: false,
                                        type: 'segment',
                                    },
                                    score: 1.0
                                });
                            });
                        } else if (row.type === 'visual') {
                            // Visual insights → individual cards
                            allTranscripts.push({
                                _id: row.id,
                                _source: {
                                    text: row.text,
                                    start_time: row.start_time,
                                    end_time: row.end_time,
                                    filename: row.video_url || url,
                                    uploaded_at: row.uploaded_at || '',
                                    is_full_text: false,
                                    type: 'visual',
                                },
                                score: 1.0
                            });
                        }
                    }

                    // Sort by timestamp
                    allTranscripts.sort((a, b) => (a._source.start_time || '').localeCompare(b._source.start_time || ''));
                }
            } catch (d1Err: any) {
                console.warn(`[D1] Listing failed:`, d1Err.message);
            }

            // Fallback: Vectorize if D1 was empty
            if (allTranscripts.length === 0) {
                try {
                    const zeroVector = new Array(768).fill(0);
                    const retrievalFilter: any = {
                        user_id: { $eq: userId },
                        video_id: { $eq: videoId }
                    };
                    const queryResult = await withVectorizeRepair('transcript', () => queryVectors('transcript', zeroVector, 100, retrievalFilter));
                    allTranscripts = (queryResult.result?.matches || []).map((m: any) => ({
                        _id: m.id,
                        _source: {
                            ...m.metadata,
                            start_time: m.metadata?.timestamps?.[0],
                            end_time: m.metadata?.timestamps?.[1]
                        },
                        score: m.score
                    }));
                    allTranscripts.sort((a, b) => (a._source.start_time || '').localeCompare(b._source.start_time || ''));
                } catch (vecErr) {
                    console.warn('[Transcripts] Vectorize fallback also failed');
                }
            }
        }
    } catch (e) {
        console.error('Failed to initialize transcripts page:', e);
    }

    return (
        <div className="h-screen bg-[#050505] text-[#ededed] overflow-hidden flex flex-col relative font-sans">
            <div className="absolute top-0 left-1/4 w-[50%] h-[30%] bg-white/[0.03] rounded-full blur-[120px] pointer-events-none"></div>

            <div className="flex-1 min-h-0 z-10">
                <div className="h-full flex flex-col p-4">
                    <TranscriptsClient
                        transcripts={allTranscripts}
                        initialQuery={query}
                        initialAgentResponse={agentResponse}
                        videoUrl={url}
                    />
                </div>
            </div>
        </div>
    );
}

// ═══ Utility: Split text into sentences ═══
function splitIntoSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by a space or end of string
    const sentences = text
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    return sentences.length > 0 ? sentences : [text];
}

// ═══ Utility: Parse timestamp string to seconds ═══
function parseTimestampToSec(ts: string): number {
    if (!ts) return 0;
    // Handle format: HH:MM:SS,mmm or HH:MM:SS.mmm
    const clean = ts.replace(',', '.');
    const parts = clean.split(':');
    if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    }
    if (parts.length === 2) {
        return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(ts) || 0;
}

// ═══ Utility: Format seconds back to HH:MM:SS,mmm ═══
function formatSec(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const ms = Math.round((s % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
