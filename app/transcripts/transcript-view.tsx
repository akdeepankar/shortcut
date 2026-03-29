'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import AgentChatInline, { AgentChatHandle } from '../agent-chat-inline';
import DeleteModal from './delete-modal';
import ClearModal from './clear-modal';
import VisualProcessingModal from '../components/visual-processing-modal';

interface TranscriptDoc {
    text: string;
    start_time: string;
    end_time: string;
    filename: string;
    uploaded_at: string;
    is_full_text?: boolean;
}

interface SearchResult {
    _id: string;
    _source: TranscriptDoc;
    score: number;
}

interface VisualDoc {
    text: string;
    timestamp: string;
    timestamp_sec: number;
    objects: string[];
    colors: string[];
    ocr_text: string;
    filename: string;
    uploaded_at: string;
}

interface VisualResult {
    _id: string;
    _source: VisualDoc;
    score: number;
}

interface TranscriptViewProps {
    transcripts: SearchResult[];
    initialQuery?: string;
    initialAgentResponse?: string | null;
    onTimestampClick?: (timestamp: { start: string; end: string; videoUrl?: string }) => void;
    isMinimized?: boolean;
    onToggleMinimize?: () => void;
}

export default function TranscriptView({ transcripts, initialQuery, initialAgentResponse, onTimestampClick, isMinimized, onToggleMinimize }: TranscriptViewProps) {
    const [activeTab, setActiveTab] = useState<'agent' | 'segments' | 'visual' | 'transcript'>('agent');
    const [visualResults, setVisualResults] = useState<VisualResult[]>([]);
    const [isVisualIndexing, setIsVisualIndexing] = useState(false);
    const [visualProcessingId, setVisualProcessingId] = useState<string | null>(null);
    const [isVisualModalOpen, setIsVisualModalOpen] = useState(false);
    const [indexes, setIndexes] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [clearModalOpen, setClearModalOpen] = useState(false);
    const [indexToDelete, setIndexToDelete] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [matches, setMatches] = useState<HTMLElement[]>([]);

    const agentChatRef = useRef<AgentChatHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    // Split transcripts into segments and full texts
    const sortedSegments = useMemo(() => {
        const allSegments = transcripts.filter(t => !t._source.is_full_text);

        // Base sort: chronological
        const baseSort = (a: SearchResult, b: SearchResult) => {
            const dateA = new Date(a._source.uploaded_at).getTime();
            const dateB = new Date(b._source.uploaded_at).getTime();
            if (Math.abs(dateB - dateA) > 1000) return dateB - dateA;
            return a._source.start_time.localeCompare(b._source.start_time);
        };

        if (!searchQuery.trim()) {
            return [...allSegments].sort(baseSort);
        }

        // If searching, group matches at the top
        const q = searchQuery.toLowerCase();
        const matching: SearchResult[] = [];
        const others: SearchResult[] = [];

        allSegments.forEach(s => {
            if (s._source.text.toLowerCase().includes(q)) {
                matching.push(s);
            } else {
                others.push(s);
            }
        });

        return [...matching.sort(baseSort), ...others.sort(baseSort)];
    }, [transcripts, searchQuery]);

    const fullTranscripts = transcripts.filter(t => t._source.is_full_text === true);

    const fetchVisuals = async () => {
        setLoading(true);
        try {
            const videoUrl = transcripts?.[0]?._source?.filename;
            if (!videoUrl) return;

            const response = await fetch(`/api/search?q=${searchQuery}&index=visual_transcript&filename=${encodeURIComponent(videoUrl)}`);
            if (response.ok) {
                const data = await response.json();
                setVisualResults(data.results || []);
            }
        } catch (error) {
            console.error('Failed to fetch visuals:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleIndexVisuals = async () => {
        const videoUrl = transcripts?.[0]?._source?.filename;
        if (!videoUrl) {
            alert('No video found to index');
            return;
        }

        setIsVisualIndexing(true);
        try {
            const response = await fetch('/api/process-visual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoUrl })
            });
            const data = await response.json();
            if (response.ok) {
                if (data.processingId) {
                    setVisualProcessingId(data.processingId);
                    setIsVisualModalOpen(true);
                }
            } else {
                throw new Error(data.error);
            }
        } catch (error: any) {
            alert(`Visual indexing failed: ${error.message}`);
        } finally {
            setIsVisualIndexing(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'visual') {
            fetchVisuals();
        }
    }, [activeTab, transcripts, searchQuery]);

    const handleClearAll = async () => {
        try {
            // 1. Clear Agent Chat
            agentChatRef.current?.clearMessages();

            // 2. Clear Elasticsearch Indices
            const indicesToClear = ['transcript', 'visual_transcript'];
            await Promise.all(indicesToClear.map(idx =>
                fetch(`/api/indexes?name=${idx}`, { method: 'DELETE' })
            ));

            // 3. Clear Local State
            setVisualResults([]);
            setIndexes([]);

            // 4. Force refresh the page data (since transcripts come from server)
            const { useRouter } = require('next/navigation');
            window.location.reload(); // Hard reload is safest for total clear

            setClearModalOpen(false);
        } catch (error) {
            console.error('Failed to clear data:', error);
            alert('Partial clear failed. Check logs.');
        }
    };

    const handleDeleteConfirm = async () => {
        if (!indexToDelete) return;
        try {
            const response = await fetch(`/api/indexes?name=${indexToDelete}`, { method: 'DELETE' });
            if (response.ok) {
                setIndexes(indexes.filter(idx => idx !== indexToDelete));
                setDeleteModalOpen(false);
                setIndexToDelete(null);
            }
        } catch (error) {
            console.error('Delete error:', error);
        }
    };

    // --- Search Logic ---
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (!searchQuery) {
                setMatches([]);
                setCurrentMatchIndex(0);
                return;
            }

            const container = activeTab === 'segments' ? scrollContainerRef.current : transcriptContainerRef.current;
            if (!container) return;

            const allMatches = Array.from(container.querySelectorAll('.search-highlight')) as HTMLElement[];
            setMatches(allMatches);
            setCurrentMatchIndex(allMatches.length > 0 ? 1 : 0);

            // Auto-scroll to first match
            if (allMatches[0]) {
                allMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100); // Small delay to allow Highlights to render
        return () => clearTimeout(timeout);
    }, [searchQuery, activeTab]);

    // Handle active match styling
    useEffect(() => {
        matches.forEach((el, i) => {
            if (i === currentMatchIndex - 1) {
                el.classList.add('bg-white', 'text-black', 'ring-2', 'ring-white/50', 'scale-110', 'z-10');
                el.classList.remove('bg-rose-500/30', 'text-rose-100');
            } else {
                el.classList.remove('bg-white', 'text-black', 'ring-2', 'ring-white/50', 'scale-110', 'z-10');
                el.classList.add('bg-rose-500/30', 'text-rose-100');
            }
        });
    }, [currentMatchIndex, matches]);

    const navigateMatch = (direction: 'next' | 'prev') => {
        if (matches.length === 0) return;

        let newIndex = direction === 'next' ? currentMatchIndex + 1 : currentMatchIndex - 1;
        if (newIndex > matches.length) newIndex = 1;
        if (newIndex < 1) newIndex = matches.length;

        setCurrentMatchIndex(newIndex);
        const matchElement = matches[newIndex - 1];
        if (matchElement) {
            matchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const Highlight = ({ text, query }: { text: string, query: string }) => {
        if (!query.trim()) return <>{text}</>;

        // Escape special characters for regex
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));

        return (
            <>
                {parts.map((part, i) =>
                    part.toLowerCase() === query.toLowerCase() ? (
                        <span key={i} className="search-highlight rounded-sm px-0.5 transition-all duration-300 bg-rose-500/30 text-rose-100">
                            {part}
                        </span>
                    ) : part
                )}
            </>
        );
    };

    const renderSearchInput = () => {
        if (activeTab !== 'segments' && activeTab !== 'transcript' && activeTab !== 'visual') return null;
        return (
            <div className="flex-shrink-0 mb-6 animate-fade-in translate-y-[-10px]">
                <div className="flex items-center gap-4 p-2 bg-white/[0.02] border border-white/10 rounded-xl backdrop-blur-3xl group transition-all focus-within:border-white/20 focus-within:bg-white/[0.04]">
                    <div className="flex items-center gap-3 flex-1 pl-3">
                        <svg className="w-4 h-4 text-neutral-500 group-focus-within:text-rose-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder={`Search keywords in ${activeTab}...`}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-transparent border-none text-sm font-medium text-white placeholder:text-neutral-600 focus:ring-0 w-full outline-none"
                        />
                    </div>

                    {searchQuery && (
                        <div className="flex items-center gap-3 px-3 py-1.5 bg-white/[0.05] rounded-lg border border-white/10 shadow-xl">
                            <span className="text-[10px] font-black font-mono text-rose-400 tabular-nums uppercase tracking-tighter">
                                {matches.length > 0 ? `${currentMatchIndex} / ${matches.length}` : '0 / 0'}
                            </span>
                            <div className="flex items-center gap-1 border-l border-white/10 pl-2">
                                <button
                                    onClick={() => navigateMatch('prev')}
                                    className="p-1 px-2 hover:bg-white/10 rounded-md transition-all text-neutral-400 hover:text-white"
                                    title="Previous Match"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                                </button>
                                <button
                                    onClick={() => navigateMatch('next')}
                                    className="p-1 px-2 hover:bg-white/10 rounded-md transition-all text-neutral-400 hover:text-white"
                                    title="Next Match"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };
    // --- End Search Logic ---


    const tabItems = [
        { id: 'agent', label: 'Agent', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
        { id: 'visual', label: 'Visual', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
        { id: 'segments', label: 'Segments', icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2' },
        { id: 'transcript', label: 'Transcript', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' }
    ] as const;

    return (
        <div className={`relative flex flex-col h-full bg-white/[0.04] transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1) glass-card border-white/10 overflow-hidden ${isMinimized ? 'p-3 items-center rounded-xl bg-white/[0.02]' : 'p-6 rounded-2xl'
            }`}>
            {/* Minimized Layer (Absolute Overlay) */}
            <div className={`absolute inset-0 flex flex-col items-center py-6 gap-6 transition-all duration-700 z-10 ${isMinimized ? 'opacity-100 scale-100 translate-x-0' : 'opacity-0 scale-75 translate-x-10 pointer-events-none'
                }`}>
                <button
                    onClick={onToggleMinimize}
                    className="p-2.5 rounded-lg glass-button text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-lg active:scale-95"
                    title="Expand Workspace"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                </button>

                <div className="flex flex-col gap-2 p-1 bg-white/[0.03] rounded-xl border border-white/5 backdrop-blur-md">
                    {tabItems.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id);
                            }}
                            className={`p-3 rounded-lg transition-all duration-300 ${activeTab === tab.id ? 'bg-white text-black shadow-lg shadow-white/10' : 'text-neutral-500 hover:text-white'}`}
                            title={tab.label}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                            </svg>
                        </button>
                    ))}
                </div>
            </div>

            {/* Expanded Content (Main Flow) */}
            <div className={`flex-1 flex flex-col min-w-0 min-h-0 transition-all duration-700 ${isMinimized ? 'opacity-0 scale-95 -translate-x-20 blur-sm pointer-events-none' : 'opacity-100 scale-100 translate-x-0'
                }`}>
                <div className="flex-shrink-0 flex items-center justify-between mb-8">
                    <div className="flex p-1 bg-white/[0.05] rounded-xl border border-white/10 backdrop-blur-md">
                        {tabItems.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setActiveTab(tab.id);
                                }}
                                className={`px-5 py-2.5 rounded-xl text-[10px] font-bold tracking-widest uppercase transition-all duration-300 flex items-center gap-2.5 whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-black shadow-lg shadow-white/10' : 'text-neutral-500 hover:text-white'}`}
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                                </svg>
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 bg-white/[0.03] p-1 rounded-xl border border-white/5">
                            <button
                                onClick={() => setClearModalOpen(true)}
                                className="p-2.5 rounded-lg glass-button text-neutral-400 hover:text-red-400 transition-all"
                                title="Total System Reset"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                            <button
                                onClick={onToggleMinimize}
                                className="p-2.5 rounded-lg glass-button text-neutral-400 hover:text-rose-400 transition-all active:scale-95"
                                title="Minimize Workspace"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                {renderSearchInput()}

                <div className="flex-1 min-h-0">
                    <div className={activeTab === 'agent' ? 'h-full' : 'hidden'}>
                        <AgentChatInline ref={agentChatRef} onTimestampClick={onTimestampClick} />
                    </div>

                    <div className={activeTab === 'visual' ? 'h-full overflow-y-auto pr-4 space-y-4' : 'hidden'}>
                        <div className="mb-6">
                            <button
                                onClick={handleIndexVisuals}
                                disabled={isVisualIndexing}
                                className="w-full py-4 bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-500/20 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                            >
                                {isVisualIndexing ? (
                                    <>
                                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Analyzing Vision...
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                        Index Visual Intelligence
                                    </>
                                )}
                            </button>
                        </div>
                        {visualResults.length > 0 ? (
                            visualResults.map((res) => (
                                <div
                                    key={res._id}
                                    onClick={() => onTimestampClick?.({ start: res._source.timestamp, end: res._source.timestamp, videoUrl: res._source.filename })}
                                    className="p-6 glass-card rounded-2xl group hover:border-white/20 transition-all cursor-pointer active:scale-[0.98] min-w-0 flex flex-col gap-4 overflow-hidden"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.4)]" />
                                            <span className="text-xs text-neutral-400 font-mono tracking-tight">{res._source.timestamp}</span>
                                        </div>
                                        <span className="text-[10px] text-neutral-600 bg-white/5 px-2 py-1 rounded-md uppercase tracking-widest font-bold">Visual Insight</span>
                                    </div>

                                    <p className="text-sm text-neutral-200 leading-relaxed font-medium break-words">
                                        <Highlight text={res._source.text} query={searchQuery} />
                                    </p>

                                    {/* Objects & Colors */}
                                    <div className="flex flex-wrap gap-2">
                                        {res._source.objects?.map((obj, i) => (
                                            <span key={i} className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[9px] font-black uppercase tracking-wider border border-emerald-500/20">
                                                {obj}
                                            </span>
                                        ))}
                                        {res._source.colors?.map((color, i) => (
                                            <span key={i} className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 text-[9px] font-black uppercase tracking-wider border border-blue-500/20">
                                                {color}
                                            </span>
                                        ))}
                                    </div>

                                    {/* OCR Text */}
                                    {res._source.ocr_text && (
                                        <div className="p-4 bg-white/[0.03] rounded-xl border border-white/5">
                                            <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500 mb-2">Screen Text Extracted</div>
                                            <p className="text-[11px] text-neutral-400 font-light leading-relaxed italic">
                                                "{res._source.ocr_text}"
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center p-10 text-center">
                                <p className="text-neutral-500 text-sm italic mb-4">No visual insights found</p>
                                <p className="text-[10px] text-neutral-600 uppercase tracking-widest leading-relaxed">
                                    Use the button above to analyze the video's visual content using GPT-4o Vision.
                                </p>
                            </div>
                        )}
                    </div>

                    <div ref={scrollContainerRef} className={activeTab === 'segments' ? 'h-full overflow-y-auto pr-4 space-y-4' : 'hidden'}>
                        {sortedSegments.length > 0 ? (
                            sortedSegments.map((res: SearchResult) => (
                                <div
                                    key={res._id}
                                    onClick={() => onTimestampClick?.({ start: res._source.start_time, end: res._source.end_time, videoUrl: res._source.filename })}
                                    className="p-5 glass-card rounded-xl group hover:border-white/20 transition-all cursor-pointer active:scale-[0.98] min-w-0"
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <svg className="w-3 h-3 text-rose-500/50 transition-colors group-hover:text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span className="text-[10px] text-neutral-500 font-mono tracking-tight">{res._source.start_time} — {res._source.end_time}</span>
                                    </div>
                                    <p className="text-sm text-neutral-300 leading-relaxed font-light break-words">
                                        <Highlight text={res._source.text} query={searchQuery} />
                                    </p>
                                </div>
                            ))
                        ) : (
                            <div className="h-full flex items-center justify-center text-neutral-500 text-sm italic">No segments found</div>
                        )}
                    </div>

                    <div ref={transcriptContainerRef} className={activeTab === 'transcript' ? 'h-full overflow-y-auto pr-4' : 'hidden'}>
                        {fullTranscripts.length > 0 ? (
                            <div className="p-8 glass-card rounded-2xl bg-white/[0.01] border-white/5">
                                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500 mb-6 flex items-center gap-2">
                                    <div className="w-1 h-1 rounded-full bg-white"></div>
                                    Full Video Transcript
                                </h3>
                                {fullTranscripts.map((res) => (
                                    <p key={res._id} className="text-base text-neutral-300 leading-8 font-light whitespace-pre-wrap">
                                        <Highlight text={res._source.text} query={searchQuery} />
                                    </p>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-neutral-500 text-sm italic">No full transcript available</div>
                        )}
                    </div>
                </div>
            </div>

            <DeleteModal
                isOpen={deleteModalOpen}
                indexName={indexToDelete || ''}
                onConfirm={handleDeleteConfirm}
                onCancel={() => setDeleteModalOpen(false)}
            />
            <ClearModal
                isOpen={clearModalOpen}
                onConfirm={handleClearAll}
                onCancel={() => setClearModalOpen(false)}
                type="agent"
            />
            <VisualProcessingModal
                isOpen={isVisualModalOpen}
                processingId={visualProcessingId || ''}
                onClose={() => setIsVisualModalOpen(false)}
                onComplete={() => fetchVisuals()}
            />
        </div>
    );
}
