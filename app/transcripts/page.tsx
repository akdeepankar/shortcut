import { askAgent } from '@/lib/agent-client';
import ProcessForm from '@/app/transcripts/process-form';
import TranscriptsClient from '@/app/transcripts/transcripts-client';

interface TranscriptDoc {
    text: string;
    start_time: string;
    end_time: string;
    filename: string;
    uploaded_at: string;
}

interface SearchResult {
    _id: string;
    _source: TranscriptDoc;
    score: number;
}

export default async function TranscriptsPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const resolvedSearchParams = await searchParams;
    const query = resolvedSearchParams?.q || '';
    const index = 'transcript';

    let allTranscripts: SearchResult[] = [];
    let agentResponse: string | null = null;

    // Note: Cloudflare Vectorize is for semantic search. 
    // For listing all documents, a metadata database like D1 or Supabase is recommended.
    try {
        // Mocking empty list for now - search will happen via API routes
        allTranscripts = [];
    } catch (e) { }


    if (query) {
        try {
            const agentResult = await askAgent(query);
            if (agentResult && agentResult.reply) {
                agentResponse = agentResult.reply;
            }
        } catch (e) {
            console.error("Agent failed:", e);
        }
    }

    return (
        <div className="h-screen bg-[#050505] text-[#ededed] overflow-hidden flex flex-col relative font-sans">
            <div className="absolute top-0 left-1/4 w-[50%] h-[30%] bg-white/[0.02] rounded-full blur-[120px] pointer-events-none"></div>

            <nav className="flex-shrink-0 z-20 border-b border-white/10 bg-black/60 backdrop-blur-2xl relative">
                {/* Subtle top accent line */}
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-rose-500/20 to-transparent"></div>

                <div className="mx-auto px-8 py-4 flex items-center justify-between gap-12">
                    <div className="flex items-center gap-4 group cursor-pointer">
                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.1)] group-hover:scale-105 transition-all duration-300">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-black">
                                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                                <path d="M4 22h16" />
                                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                                <path d="M18 2h-4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
                            </svg>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-black tracking-[0.2em] uppercase text-white leading-none mb-1">Clipper</span>
                            <span className="text-[10px] text-neutral-500 font-medium tracking-wider">Workspace Alpha</span>
                        </div>
                    </div>

                    <div className="flex-1 max-w-2xl px-4">
                        <ProcessForm />
                    </div>

                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-6 px-4 border-r border-white/10">
                            <button className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 hover:text-white transition-all transform hover:translate-y-[-1px]">Analytics</button>
                            <button className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 hover:text-white transition-all transform hover:translate-y-[-1px]">Logs</button>
                        </div>
                        <div className="flex items-center gap-3 pl-2">
                            <div className="text-right hidden sm:block">
                                <p className="text-[10px] font-black text-white uppercase tracking-tight">Ak Deepankar</p>
                                <p className="text-[9px] text-rose-500/80 uppercase font-bold tracking-tighter">Pro Plan</p>
                            </div>
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.01] border border-white/10 flex items-center justify-center hover:border-rose-500/50 transition-all cursor-pointer group shadow-xl ring-1 ring-black">
                                <div className="w-2.5 h-2.5 rounded-full bg-rose-500 group-hover:scale-125 transition-all shadow-[0_0_10px_rgba(244,63,94,0.4)]"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </nav>

            <div className="flex-1 min-h-0 z-10">
                <div className="h-full flex flex-col p-4">
                    <TranscriptsClient
                        transcripts={allTranscripts}
                        initialQuery={query}
                        initialAgentResponse={agentResponse}
                    />
                </div>
            </div>
        </div>
    );
}
