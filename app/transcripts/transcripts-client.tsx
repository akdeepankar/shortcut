'use client';

import { useState, useEffect } from 'react';
import TranscriptView from './transcript-view';
import VideoPreview from './video-preview';
import ProcessForm from './process-form';
import ProcessingModal from '../components/processing-modal';
import { generateSocialMetadata } from '../actions-meta';
import ReactMarkdown from 'react-markdown';
import { useRef } from 'react';

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

interface TranscriptsClientProps {
    transcripts: SearchResult[];
    initialQuery?: string;
    initialAgentResponse?: string | null;
    videoUrl?: string; // Add this
}

interface FinalizedClip {
    clipUrl: string;
    startTime: string;
    endTime: string;
    sourceUrl: string;
    transcript?: string;
    voiceoverBlocks?: any[];
    captionStyles?: any;
    showCaptions?: boolean;
}

interface SocialMetadata {
    title: string;
    description: string;
    tags: string[];
    hook: string;
    platform_advice: string;
}

export default function TranscriptsClient({ transcripts, initialQuery, initialAgentResponse, videoUrl }: TranscriptsClientProps) {
    const [selectedTimestamp, setSelectedTimestamp] = useState<{ start: string; end: string; videoUrl?: string } | null>(null);
    const [isMinimized, setIsMinimized] = useState(false);
    const [finalizedClip, setFinalizedClip] = useState<FinalizedClip | null>(null);
    const [socialMeta, setSocialMeta] = useState<SocialMetadata | null>(null);
    const [isGeneratingMeta, setIsGeneratingMeta] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string>('global');
    const [finalVideoIsPlaying, setFinalVideoIsPlaying] = useState(false);
    const [finalVideoPreciseTime, setFinalVideoPreciseTime] = useState(0);
    const finalVideoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        let rafId: number;
        const update = () => {
            if (finalVideoRef.current && finalVideoIsPlaying) {
                setFinalVideoPreciseTime(finalVideoRef.current.currentTime);
            }
            rafId = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(rafId);
    }, [finalVideoIsPlaying]);

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    useEffect(() => {
        let id = localStorage.getItem('clipper_user_id');
        if (!id) {
            id = `user_${Math.random().toString(36).substring(2, 15)}`;
            localStorage.setItem('clipper_user_id', id);
        }
        setUserId(id);
    }, []);

    const [processingState, setProcessingState] = useState<{ isOpen: boolean; url: string; engine: 'openai' | 'elevenlabs'; userId?: string }>({
        isOpen: false,
        url: '',
        engine: 'openai',
        userId: 'global'
    });

    useEffect(() => {
        const handleProcessEvent = (e: any) => {
            const { url, engine, userId: eventUserId } = e.detail;
            setProcessingState({ isOpen: true, url, engine, userId: eventUserId || userId });
        };

        const handlePreviewEvent = (e: any) => {
            setSelectedTimestamp(e.detail);
        };

        window.addEventListener('app:process-video', handleProcessEvent as any);
        window.addEventListener('app:preview-timestamp', handlePreviewEvent as any);
        return () => {
            window.removeEventListener('app:process-video', handleProcessEvent as any);
            window.removeEventListener('app:preview-timestamp', handlePreviewEvent as any);
        };
    }, []);

    const handleFinalize = (data: Omit<FinalizedClip, 'transcript'>) => {
        // Find relevant transcript text for this time range
        const relevantSegments = transcripts
            .filter(t => !t._source.is_full_text && t._source.filename === data.sourceUrl)
            .filter(t => {
                const s = t._source.start_time;
                return s >= data.startTime && s <= data.endTime;
            })
            .map(t => t._source.text)
            .join(' ');

        setFinalizedClip({ ...data, transcript: relevantSegments });
        setSocialMeta(null); // Reset metadata when new clip is finalized
    };

    const handleGenerateSocial = async () => {
        if (!finalizedClip?.transcript) {
            alert("No transcript data found for this segment to analyze.");
            return;
        }

        setIsGeneratingMeta(true);
        try {
            const meta = await generateSocialMetadata(finalizedClip.transcript);
            setSocialMeta(meta);
        } catch (error) {
            console.error('Failed to generate social metadata:', error);
            alert('Metadata generation failed. Check console.');
        } finally {
            setIsGeneratingMeta(false);
        }
    };

    const [isEditorActive, setIsEditorActive] = useState(false);
    const [editorSessionState, setEditorSessionState] = useState<{
        voiceoverBlocks: any[];
        trimStart: number;
        trimEnd: number;
        captionStyles: any;
        isEditorActive: boolean;
        showFullVideo: boolean;
        fullVideoUrl: string | null;
        timestamp: any;
        clipUrl?: string | null;
    } | null>(null);

    // PERSISTENCE SYNC: Sync with Cloudflare Durable State Worker / LocalStorage for true durability
    useEffect(() => {
        const SESSION_ID = userId || 'default';
        const WORKER_URL = 'https://durable-state.akdeepaknyc.workers.dev';

        const loadRemoteState = async () => {
            if (!editorSessionState) {
                try {
                    const res = await fetch(`${WORKER_URL}?sessionId=${SESSION_ID}`);
                    if (res.ok) {
                        const remoteState = await res.json();
                        if (remoteState && Object.keys(remoteState).length > 0) {
                            setEditorSessionState(remoteState);
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('Durable State fetch failed, falling back to local:', e);
                }

                // Fallback to local storage if remote fails or is empty
                const saved = localStorage.getItem('clipper_editor_session');
                if (saved) {
                    try {
                        const parsed = JSON.parse(saved);
                        setEditorSessionState(parsed);
                    } catch (e) {}
                }
            }
        };

        loadRemoteState();
    }, [userId]);

    useEffect(() => {
        if (!editorSessionState) return;

        const syncState = async () => {
            const SESSION_ID = userId || 'default';
            const WORKER_URL = 'https://durable-state.akdeepaknyc.workers.dev';

            // 1. Local Persistence
            localStorage.setItem('clipper_editor_session', JSON.stringify(editorSessionState));

            // 2. Cloud Persistence (Cloudflare KV via Worker)
            try {
                await fetch(`${WORKER_URL}?sessionId=${SESSION_ID}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(editorSessionState)
                });
            } catch (e) {
                console.error('Failed to sync to Durable State Worker:', e);
            }
        };

        const timeoutId = setTimeout(syncState, 1000); // Debounce sync
        return () => clearTimeout(timeoutId);
    }, [editorSessionState, userId]);

    const effectiveVideoUrl = videoUrl || transcripts?.[0]?._source?.filename || undefined;

    return (
        <div className="flex flex-col h-full flex-1 min-h-0 overflow-hidden pt-6">

            <div className="flex gap-6 h-full flex-1 min-h-0 animate-fade-in overflow-hidden relative">
            {/* Left Column - Large Workspace (Chat/Transcripts OR Finalized Mode) */}
            <div
                className={`flex flex-col h-full min-h-0 transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1) overflow-hidden ${isMinimized ? 'w-[72px] flex-shrink-0' : 'flex-1 min-w-[400px]'
                    }`}
            >
                {finalizedClip ? (
                    <div className={`relative flex flex-col h-full bg-white/[0.04] transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1) glass-card border-white/10 overflow-hidden ${isMinimized ? 'p-3 items-center rounded-xl bg-white/[0.02]' : 'p-8 rounded-2xl'}`}>
                        {/* Minimized Layer (Absolute Overlay) */}
                        <div className={`absolute inset-0 flex flex-col items-center py-6 gap-6 transition-all duration-700 z-10 ${isMinimized ? 'opacity-100 scale-100 translate-x-0' : 'opacity-0 scale-75 translate-x-10 pointer-events-none'}`}>
                            <button
                                onClick={() => setIsMinimized(false)}
                                className="p-2.5 rounded-lg glass-button text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-lg active:scale-95"
                                title="Expand Workspace"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                </svg>
                            </button>

                            <button
                                onClick={() => setFinalizedClip(null)}
                                className="p-2.5 rounded-lg glass-button text-neutral-500 hover:text-white transition-all"
                                title="Back to Editor"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                        </div>

                        {/* Expanded Content */}
                        <div className={`flex-1 flex flex-col min-w-0 min-h-0 transition-all duration-700 ${isMinimized ? 'opacity-0 scale-95 -translate-x-20 blur-sm pointer-events-none' : 'opacity-100 scale-100 translate-x-0'}`}>
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Final Production</h1>
                                    <p className="text-xs text-neutral-500 uppercase tracking-widest font-bold">Processed & Ready for Export</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setFinalizedClip(null)}
                                        className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest border border-white/10"
                                    >
                                        Back to Editor
                                    </button>
                                    <button
                                        onClick={() => {
                                            const link = document.createElement('a');
                                            link.href = finalizedClip.clipUrl;
                                            link.download = `production_${Date.now()}.mp4`;
                                            document.body.appendChild(link);
                                            link.click();
                                            document.body.removeChild(link);
                                        }}
                                        className="px-6 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition-all text-[10px] font-black uppercase tracking-widest shadow-[0_0_20px_rgba(225,29,72,0.4)] flex items-center gap-2"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        Download Master
                                    </button>
                                    <button
                                        onClick={() => setIsMinimized(true)}
                                        className="p-2.5 rounded-lg glass-button text-neutral-400 hover:text-rose-400 transition-all active:scale-95 border border-white/5"
                                        title="Minimize Workspace"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 min-h-0 bg-black rounded-3xl overflow-hidden shadow-2xl border border-white/5 relative group">
                                <video
                                    ref={finalVideoRef}
                                    src={finalizedClip.clipUrl}
                                    controls
                                    autoPlay
                                    onPlay={() => setFinalVideoIsPlaying(true)}
                                    onPause={() => setFinalVideoIsPlaying(false)}
                                    className="w-full h-full object-contain"
                                />
                                
                                {/* Captions are now burned into the video file by the backend FFmpeg process */}

                                <div className="absolute top-6 left-6 px-4 py-2 bg-rose-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
                                    Full Quality Master
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <TranscriptView
                        transcripts={transcripts}
                        initialQuery={initialQuery}
                        initialAgentResponse={initialAgentResponse}
                        onTimestampClick={setSelectedTimestamp}
                        isMinimized={isMinimized}
                        onToggleMinimize={() => setIsMinimized(!isMinimized)}
                        videoUrl={effectiveVideoUrl}
                    />
                )}
            </div>

            {/* Right Column - Secondary Workspace (Preview OR Social Generation) - Hidden in Finalized Mode */}
            {!finalizedClip && (
            <div
                className={`flex flex-col h-full min-h-0 transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1) flex-1 overflow-hidden min-w-[300px]`}
            >
                <VideoPreview
                    timestamp={selectedTimestamp}
                    defaultVideoUrl={effectiveVideoUrl}
                    onFinalize={handleFinalize}
                    initialSessionState={editorSessionState}
                    onSessionUpdate={setEditorSessionState}
                    onEditorToggle={(active) => {
                        setIsMinimized(active);
                        setIsEditorActive(active);
                    }}
                />
            </div>
            )}

            {/* In-Workspace Processing Modal */}
            <ProcessingModal
                isOpen={processingState.isOpen}
                videoUrl={processingState.url}
                engine={processingState.engine}
                userId={processingState.userId}
                onClose={() => setProcessingState(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    </div>
);
}
