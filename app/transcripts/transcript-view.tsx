'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect, useMemo } from 'react';
import AgentChatInline, { AgentChatHandle } from '../agent-chat-inline';
import DeleteModal from './delete-modal';
import ClearModal from './clear-modal';
import ContextDebugModal from '../components/context-debug-modal';

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

interface VisualDoc {
    text: string;
    start_time: string;
    end_time: string;
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
    onTimestampClick?: (timestamp: { start: string; end: string; videoUrl?: string; segments?: { start: string; end: string }[] }) => void;
    isMinimized?: boolean;
    onToggleMinimize?: () => void;
    videoUrl?: string; // Add this
}

export default function TranscriptView({ transcripts, initialQuery, initialAgentResponse, onTimestampClick, isMinimized, onToggleMinimize, videoUrl: propVideoUrl }: TranscriptViewProps) {
    const [activeTab, setActiveTab] = useState<'agent' | 'segments' | 'visual'>('agent');
    const [visualResults, setVisualResults] = useState<VisualResult[]>([]);
    const [indexes, setIndexes] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [clearModalOpen, setClearModalOpen] = useState(false);
    const [indexToDelete, setIndexToDelete] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [matches, setMatches] = useState<HTMLElement[]>([]);
    const [debugContext, setDebugContext] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedClips, setSelectedClips] = useState<Map<string, { start: string, end: string, videoUrl: string }>>(new Map());
    const router = useRouter();

    const toggleSelection = (e: React.MouseEvent, id: string, start: string, end: string, videoUrl: string) => {
        e.stopPropagation();
        const newSelection = new Map(selectedClips);
        if (newSelection.has(id)) {
            newSelection.delete(id);
        } else {
            newSelection.set(id, { start: start || '', end: end || '', videoUrl });
        }
        setSelectedClips(newSelection);
    };

    const handleJoinSelected = () => {
        if (selectedClips.size === 0) return;
        const clips = Array.from(selectedClips.values()).sort((a, b) => {
            return a.start.localeCompare(b.start);
        });

        const first = clips[0];
        const last = clips[clips.length - 1];

        onTimestampClick?.({
            start: first.start,
            end: last.end,
            videoUrl: first.videoUrl,
            segments: clips.map(c => ({ start: c.start, end: c.end }))
        });
        
        setSelectedClips(new Map());
    };

    const agentChatRef = useRef<AgentChatHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    // Filter speech-only segments (no visual, no full text)
    const sortedSegments = useMemo(() => {
        const allSegments = transcripts.filter(t => {
            const isFull = t?._source?.is_full_text;
            const isVisual = t?._source?.type === 'visual';
            return t?._source && String(isFull) !== 'true' && isFull !== true && !isVisual;
        });

        // Base sort: chronological by start_time
        const baseSort = (a: SearchResult, b: SearchResult) => {
            if (!a?._source || !b?._source) return 0;
            return (a._source.start_time || '').localeCompare(b._source.start_time || '');
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



    // 1. Unified URL Normalization for consistent MD5 fingerprints
    const normalizedVideoUrl = useMemo(() => {
        const rawUrl = propVideoUrl || transcripts?.[0]?._source?.filename;
        if (!rawUrl) return null;
        try {
            const urlObj = new URL(rawUrl);
            const v = urlObj.searchParams.get('v');
            if (v) {
                return `${urlObj.origin}${urlObj.pathname}?v=${v}`;
            }
            return rawUrl;
        } catch (e) {
            return rawUrl;
        }
    }, [propVideoUrl, transcripts]);

    // Robust Visual Fetching with Cancellation & Debounce
    useEffect(() => {
        if (activeTab !== 'visual' || !normalizedVideoUrl) return;

        const controller = new AbortController();
        const timeoutId = setTimeout(async () => {
            setLoading(true);
            try {
                const userId = localStorage.getItem('clipper_user_id') || 'global';
                const queryParams = new URLSearchParams({
                    q: searchQuery,
                    index: 'visual_transcript',
                    filename: normalizedVideoUrl,
                    userId: userId
                });

                const response = await fetch(`/api/search?${queryParams}`, { signal: controller.signal });
                if (response.ok) {
                    const data = await response.json();
                    setVisualResults(data.results || []);
                }
            } catch (error: any) {
                if (error.name !== 'AbortError') {
                    console.error('Failed to fetch visuals:', error);
                }
            } finally {
                setLoading(false);
            }
        }, 300); // 300ms Debounce

        return () => {
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [activeTab, searchQuery, normalizedVideoUrl, refreshKey]);

    const handleHardRefresh = () => {
        setIsRefreshing(true);
        
        // 1. Trigger Server-side Re-fetch
        router.refresh();
        
        // 2. Trigger Client-side visual re-fetch
        setRefreshKey(prev => prev + 1);
        
        // 3. Clear loading state after a delay
        setTimeout(() => setIsRefreshing(false), 2000);
    };

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
            setSelectedClips(new Map());

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

    const formatTimestamp = (ts: string) => {
        if (!ts) return "";
        const base = ts.split(/[.,]/)[0]; // Remove milliseconds
        return base.startsWith('00:') ? base.substring(3) : base;
    };

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
        if (activeTab !== 'segments' && activeTab !== 'visual') return null;
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
        { id: 'segments', label: 'Transcript', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
        { id: 'visual', label: 'Visual', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
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
                
                {/* Header Actions */}
                <div className="flex-shrink-0 grid grid-cols-3 items-center mb-8">
                    {/* Left: App Title */}
                    <div className="flex items-center">
                        <div className="flex items-center gap-2 relative group">
                            <img src="https://cdn-icons-png.freepik.com/256/4415/4415274.png?semt=ais_white_label" className="w-5 h-5 relative z-10 filter invert opacity-80" alt="Shortcut Logo" />
                            <span className="text-xl font-bold tracking-tighter text-slate-300">Shortcut.</span>
                        </div>
                    </div>

                    {/* Middle: Tab Switcher */}
                    <div className="flex justify-center">
                        <div className="flex p-1 bg-white/[0.05] rounded-xl border border-white/10 backdrop-blur-md">
                            {tabItems.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-5 py-2.5 rounded-xl text-[10px] font-bold tracking-widest uppercase transition-all duration-300 flex items-center gap-2.5 whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-black shadow-lg shadow-white/10' : 'text-neutral-500 hover:text-white'}`}
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                                    </svg>
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Right: Meta Controls */}
                    <div className="flex items-center justify-end gap-2">
                        <div className="flex items-center gap-2 bg-white/[0.03] p-1 rounded-xl border border-white/5">
                            <button
                                onClick={handleHardRefresh}
                                className={`p-2.5 rounded-lg glass-button text-neutral-400 hover:text-emerald-400 transition-all ${isRefreshing ? 'animate-spin text-emerald-500' : ''}`}
                                title="Sync Intelligence (Hard Fetch)"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
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
                        <AgentChatInline 
                            ref={agentChatRef} 
                            onTimestampClick={onTimestampClick} 
                            videoUrl={normalizedVideoUrl || undefined} 
                            onDebugClick={(content) => setDebugContext(content)}
                        />
                    </div>

                    <div className={activeTab === 'visual' ? 'h-full overflow-y-auto pr-4 space-y-4' : 'hidden'}>
                        {visualResults.length > 0 ? (
                            visualResults.map((res) => {
                                const isSelected = selectedClips.has(res._id);
                                const tsStart = res._source.start_time || (res._source as any).timestamp;
                                const tsEnd = res._source.end_time || (res._source as any).timestamp;
                                return (
                                <div
                                    key={res._id}
                                    onClick={() => onTimestampClick?.({ 
                                        start: tsStart, 
                                        end: tsEnd, 
                                        videoUrl: res._source.filename 
                                    })}
                                    className={`relative p-6 glass-card rounded-2xl group hover:border-white/20 transition-all cursor-pointer active:scale-[0.98] min-w-0 flex flex-col gap-4 overflow-hidden ${isSelected ? 'ring-2 ring-emerald-500 bg-emerald-500/5' : ''}`}
                                >
                                    <button 
                                        onClick={(e) => toggleSelection(e, res._id, tsStart, tsEnd, res._source.filename)}
                                        className={`absolute right-4 top-4 p-1 rounded-md border transition-all z-10 ${isSelected ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg' : 'border-white/20 text-transparent hover:border-white/40 hover:text-white/50 group-hover:text-white/20 hover:bg-white/5'}`}
                                        title={isSelected ? 'Deselect clip' : 'Select clip to join'}
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    </button>

                                    <div className="flex items-center justify-between pr-8">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.4)]" />
                                            <span className="text-xs text-neutral-400 font-mono tracking-tight">
                                                {res._source.start_time ? (
                                                    <>{formatTimestamp(res._source.start_time)} — {formatTimestamp(res._source.end_time)}</>
                                                ) : (
                                                    <>{formatTimestamp((res._source as any).timestamp)}</>
                                                )}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-neutral-600 bg-white/5 px-2 py-1 rounded-md uppercase tracking-widest font-bold">Visual Insight</span>
                                    </div>

                                    <p className="text-sm text-neutral-200 leading-relaxed font-medium break-words">
                                        <Highlight text={res._source.text} query={searchQuery} />
                                    </p>

                                    {/* Objects & Colors */}
                                    <div className="flex flex-wrap gap-2">
                                        {(Array.isArray(res._source.objects) ? res._source.objects : (typeof (res._source.objects as any) === 'string' ? (res._source.objects as any).split(', ') : [])).map((obj: any, i: number) => (
                                            <span key={i} className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[9px] font-black uppercase tracking-wider border border-emerald-500/20">
                                                {obj}
                                            </span>
                                        ))}
                                        {(Array.isArray(res._source.colors) ? res._source.colors : (typeof (res._source.colors as any) === 'string' ? (res._source.colors as any).split(', ') : [])).map((color: any, i: number) => (
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
                                );
                            })
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center p-10 text-center">
                                <p className="text-neutral-500 text-sm italic mb-4">Processing visual insights...</p>
                                <p className="text-[10px] text-neutral-600 uppercase tracking-widest leading-relaxed">
                                    Visual intelligence is automatically analyzed during video ingestion. If no results appear, try searching for specific objects or scenes.
                                </p>
                            </div>
                        )}
                    </div>

                    <div ref={scrollContainerRef} className={activeTab === 'segments' ? 'h-full overflow-y-auto pr-4 space-y-3' : 'hidden'}>
                        {sortedSegments.length > 0 ? (
                            sortedSegments.map((res: SearchResult) => {
                                const isSelected = selectedClips.has(res._id);
                                return (
                                <div
                                    key={res._id}
                                    onClick={() => onTimestampClick?.({ start: res._source.start_time, end: res._source.end_time, videoUrl: res._source.filename })}
                                    className={`relative p-5 glass-card rounded-xl group hover:border-white/20 transition-all cursor-pointer active:scale-[0.98] min-w-0 border-l-2 border-l-rose-500/30 ${isSelected ? 'ring-2 ring-rose-500 bg-white/[0.08]' : ''}`}
                                >
                                    <button 
                                        onClick={(e) => toggleSelection(e, res._id, res._source.start_time, res._source.end_time, res._source.filename)}
                                        className={`absolute right-4 top-4 p-1 rounded-md border transition-all z-10 ${isSelected ? 'bg-rose-500 border-rose-500 text-white shadow-lg' : 'border-white/20 text-transparent hover:border-white/40 hover:text-white/50 group-hover:text-white/20 hover:bg-white/5'}`}
                                        title={isSelected ? 'Deselect clip' : 'Select clip to join'}
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    </button>

                                    <div className="flex items-center gap-2 mb-2 pr-8">
                                        <span className="text-rose-400 text-xs">🗣</span>
                                        <span className="text-[10px] text-neutral-500 font-mono tracking-tight">{formatTimestamp(res._source.start_time)} — {formatTimestamp(res._source.end_time)}</span>
                                    </div>
                                    <p className="text-sm text-neutral-300 leading-relaxed font-light break-words">
                                        <Highlight text={res._source.text} query={searchQuery} />
                                    </p>
                                </div>
                                );
                            })
                        ) : (
                            <div className="h-full flex items-center justify-center text-neutral-500 text-sm italic">No transcript segments found</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Floating Action Bar for Multi-Selection */}
            {selectedClips.size > 0 && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#111]/80 backdrop-blur-2xl border border-white/20 px-5 py-3 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] animate-fade-in transition-all overflow-hidden">
                    <div className="flex items-center gap-2 pr-2 border-r border-white/10">
                        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">
                            {selectedClips.size}
                        </div>
                        <span className="text-xs font-medium text-neutral-300">Selected</span>
                    </div>
                    <button 
                        onClick={handleJoinSelected} 
                        className="px-5 py-2.5 bg-rose-500 hover:bg-rose-600 rounded-xl text-xs font-bold text-white shadow-lg shadow-rose-500/20 transition-all active:scale-95 flex items-center gap-2"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Join & Edit
                    </button>
                    <button 
                        onClick={() => setSelectedClips(new Map())} 
                        className="px-4 py-2 hover:bg-white/10 rounded-xl text-xs font-medium transition-all active:scale-95 text-neutral-400"
                    >
                        Clear
                    </button>
                </div>
            )}

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

            <ContextDebugModal 
                isOpen={!!debugContext}
                content={debugContext || ''}
                onClose={() => setDebugContext(null)}
            />
        </div>
    );
}
