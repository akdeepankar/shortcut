'use client';

import { useState, useEffect } from 'react';
import TranscriptView from './transcript-view';
import VideoPreview from './video-preview';
import ProcessForm from './process-form';
import ProcessingModal from '../components/processing-modal';
import { generateSocialMetadata } from '../actions-meta';
import ReactMarkdown from 'react-markdown';
import { useRef } from 'react';
import { generatePostCaption, generateThumbnailText } from '@/app/actions';
import { toPng } from 'html-to-image';

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
    magicPrompt?: string;
}

interface SocialMetadata {
    title: string;
    description: string;
    tags: string[];
    hook: string;
    platform_advice: string;
}

export default function TranscriptsClient({ transcripts, initialQuery, initialAgentResponse, videoUrl }: TranscriptsClientProps) {
    const [selectedTimestamp, setSelectedTimestamp] = useState<{ start: string; end: string; videoUrl?: string; segments?: { start: string; end: string }[] } | null>(null);
    const [isMinimized, setIsMinimized] = useState(false);
    const [finalizedClip, setFinalizedClip] = useState<FinalizedClip | null>(null);
    const [socialMeta, setSocialMeta] = useState<SocialMetadata | null>(null);
    const [isGeneratingMeta, setIsGeneratingMeta] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string>('global');
    const [finalVideoIsPlaying, setFinalVideoIsPlaying] = useState(false);
    const [finalVideoPreciseTime, setFinalVideoPreciseTime] = useState(0);
    const finalVideoRef = useRef<HTMLVideoElement>(null);
    const captureContainerRef = useRef<HTMLDivElement>(null);
    const [showSocialPanel, setShowSocialPanel] = useState(false);
    const [postCaption, setPostCaption] = useState<string>('');
    const [isGeneratingCaption, setIsGeneratingCaption] = useState<boolean>(false);
    const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
    const [thumbnailPrompt, setThumbnailPrompt] = useState<string>('');
    const [thumbnailOverlayText, setThumbnailOverlayText] = useState<string>('');
    const [isGeneratingThumbText, setIsGeneratingThumbText] = useState<boolean>(false);
    const [textSize, setTextSize] = useState<number>(8);
    const [textColor, setTextColor] = useState<string>('#ffffff');
    const [textStroke, setTextStroke] = useState<boolean>(true);
    const [textPosition, setTextPosition] = useState<'top' | 'center' | 'bottom'>('bottom');

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
                        <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto custom-scrollbar pr-2 transition-all duration-700 ${isMinimized ? 'opacity-0 scale-95 -translate-x-20 blur-sm pointer-events-none' : 'opacity-100 scale-100 translate-x-0'}`}>
                            <div className="flex items-center justify-between mb-8 shrink-0">
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
                                        Download
                                    </button>
                                    <button
                                        onClick={() => setShowSocialPanel(!showSocialPanel)}
                                        className={`px-6 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border ${showSocialPanel ? 'bg-amber-500 text-black border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'bg-transparent hover:bg-white/10 text-amber-500 border-amber-500/50 hover:border-amber-500'}`}
                                    >
                                        Thumbnail
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 min-h-[45vh] shrink-0 bg-black rounded-3xl overflow-hidden shadow-2xl border border-white/5 relative group">
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

            {/* Right Column - Secondary Workspace */}
            {(!finalizedClip || showSocialPanel) && (
            <div
                className={`flex flex-col h-full min-h-0 transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1) flex-1 overflow-hidden min-w-[300px]`}
            >
                {!finalizedClip ? (
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
                ) : (
                    <div className="flex-1 flex flex-col min-h-0 bg-white/[0.04] rounded-2xl p-8 border border-white/10 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center justify-between shrink-0 mb-8">
                            <div>
                                <h2 className="text-xl font-bold tracking-tight text-white mb-1">Distribution Setup</h2>
                                <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold">Generate Marketing Assets</p>
                            </div>
                            <button onClick={() => setShowSocialPanel(false)} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all text-[10px] font-black uppercase border border-white/10">Close setup</button>
                        </div>

                        {/* Thumbnail & Caption Logic */}
                        <div className="flex flex-col gap-6 shrink-0 pb-12">
                            {/* Thumbnail Capture Card */}
                            <div className="p-6 bg-white/[0.03] border border-white/5 rounded-3xl flex flex-col gap-4 relative overflow-hidden group/capture-card">
                                <div className="absolute inset-x-0 -bottom-20 h-40 bg-amber-500/5 blur-3xl group-hover/capture-card:bg-amber-500/10 transition-colors pointer-events-none" />
                                <div className="flex items-center justify-between relative z-10">
                                    <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
                                        <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        Digital Asset Thumbnail
                                    </h3>
                                    {thumbnailDataUrl && (
                                        <button onClick={async () => {
                                            if (!captureContainerRef.current) return;
                                            try {
                                                const nativeWidth = finalVideoRef.current?.videoWidth || 1920;
                                                const dataUrl = await toPng(captureContainerRef.current, { 
                                                    cacheBust: true, 
                                                    pixelRatio: nativeWidth / captureContainerRef.current.clientWidth,
                                                    filter: (node) => {
                                                        return !node.classList?.contains('exclude-from-capture');
                                                    }
                                                });
                                                const link = document.createElement('a');
                                                link.href = dataUrl;
                                                link.download = `thumbnail_${Date.now()}.png`;
                                                link.click();
                                            } catch (err) {
                                                console.error('Failed to export thumbnail', err);
                                            }
                                        }} className="text-[9px] font-bold uppercase text-amber-500 hover:text-amber-400 transition-colors">Download</button>
                                    )}
                                </div>
                                <p className="text-[10px] text-neutral-400 font-medium relative z-10">Scrub the video above to an optimal frame, then generate your promotional thumbnail.</p>
                                
                                <div className="flex flex-col gap-2 relative z-10 w-full mb-2">
                                    <div className="flex items-center justify-between text-[10px] text-white/50 mb-1">
                                        <span>Fine-Tune Selection</span>
                                        <span>{finalVideoRef.current?.currentTime?.toFixed(1) || '0.0'}s</span>
                                    </div>
                                    <input 
                                        type="range"
                                        min={0}
                                        max={finalVideoRef.current?.duration || 100}
                                        step={0.1}
                                        value={finalVideoRef.current?.currentTime || 0}
                                        onChange={(e) => {
                                            if (finalVideoRef.current) {
                                                const val = parseFloat(e.target.value);
                                                finalVideoRef.current.currentTime = val;
                                                finalVideoRef.current.pause();
                                            }
                                        }}
                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-amber-500 group-hover/capture-card:bg-white/20 transition-colors"
                                    />
                                </div>

                                {thumbnailDataUrl ? (
                                    <div className="flex flex-col gap-4">
                                        <div ref={captureContainerRef} className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 group/thumb shadow-2xl z-10 flex flex-col items-center justify-center" style={{ containerType: 'inline-size' }}>
                                            <img src={thumbnailDataUrl} className="w-full h-full object-cover" alt="Selected Thumbnail" />
                                            {thumbnailOverlayText && (
                                                <div className={`absolute inset-0 flex flex-col items-center pointer-events-none ${textPosition === 'top' ? 'justify-start pt-[10%]' : (textPosition === 'center' ? 'justify-center' : 'justify-end pb-[10%]')}`}>
                                                    <span 
                                                        className="font-black uppercase text-center drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] leading-tight"
                                                        style={{ 
                                                            color: textColor,
                                                            fontSize: `${textSize}cqw`,
                                                            WebkitTextStroke: textStroke ? `${textSize * 0.05}cqw black` : 'none'
                                                        }}
                                                    >
                                                        {thumbnailOverlayText}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-4 backdrop-blur-sm z-20 exclude-from-capture">
                                                <button onClick={() => { setThumbnailDataUrl(null); setThumbnailOverlayText(''); }} className="px-6 py-2 bg-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white hover:bg-white hover:text-black transition-all border border-white/20">Recapture Frame</button>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-col gap-3 relative z-10 bg-black/20 p-4 rounded-xl border border-white/5">
                                            <div className="flex items-center justify-between text-[10px] text-white/50 uppercase font-black tracking-widest">
                                                <span>AI Viral Hooks</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <input 
                                                    type="text" 
                                                    value={thumbnailPrompt} 
                                                    onChange={e => setThumbnailPrompt(e.target.value)}
                                                    placeholder="e.g. Crazy AI coding secrets!" 
                                                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30"
                                                />
                                                <button 
                                                    disabled={isGeneratingThumbText}
                                                    onClick={async () => {
                                                        if (!thumbnailPrompt) return;
                                                        setIsGeneratingThumbText(true);
                                                        const res = await generateThumbnailText(thumbnailPrompt);
                                                        setThumbnailOverlayText(res);
                                                        setIsGeneratingThumbText(false);
                                                    }}
                                                    className={`px-4 text-[10px] font-black uppercase rounded-lg transition-colors flex items-center gap-2 ${isGeneratingThumbText ? 'bg-neutral-800 text-neutral-500' : 'bg-amber-500 hover:bg-amber-400 text-black'}`}
                                                >
                                                    {isGeneratingThumbText ? '...' : 'Spark'}
                                                </button>
                                            </div>
                                            {(thumbnailOverlayText || isGeneratingThumbText) && (
                                                <div className="flex flex-col gap-3 mt-2">
                                                    <input 
                                                        type="text" 
                                                        value={thumbnailOverlayText} 
                                                        onChange={e => setThumbnailOverlayText(e.target.value)}
                                                        placeholder="Overlay Text..." 
                                                        className="w-full bg-white/5 border border-amber-500/30 text-amber-500 font-black uppercase text-center rounded-lg px-3 py-2 text-sm"
                                                    />
                                                    <div className="flex items-center gap-4 bg-black/40 p-3 rounded-xl border border-white/5">
                                                        <div className="flex flex-col gap-1 items-center">
                                                            <span className="text-[9px] text-white/50 uppercase font-bold tracking-widest">Pos</span>
                                                            <div className="flex gap-1 bg-white/5 p-0.5 rounded-lg">
                                                              <button onClick={() => setTextPosition('top')} className={`w-5 h-5 flex items-center justify-center rounded text-[8px] font-black transition-colors ${textPosition==='top' ? 'bg-amber-500 text-black' : 'text-neutral-400 hover:text-white'}`}>T</button>
                                                              <button onClick={() => setTextPosition('center')} className={`w-5 h-5 flex items-center justify-center rounded text-[8px] font-black transition-colors ${textPosition==='center' ? 'bg-amber-500 text-black' : 'text-neutral-400 hover:text-white'}`}>C</button>
                                                              <button onClick={() => setTextPosition('bottom')} className={`w-5 h-5 flex items-center justify-center rounded text-[8px] font-black transition-colors ${textPosition==='bottom' ? 'bg-amber-500 text-black' : 'text-neutral-400 hover:text-white'}`}>B</button>
                                                            </div>
                                                        </div>
                                                        <div className="flex-1 flex flex-col gap-1">
                                                            <span className="text-[9px] text-white/50 uppercase font-bold tracking-widest flex justify-between"><span>Text Size</span><span>{textSize}%</span></span>
                                                            <input 
                                                                type="range" min={4} max={20} step={0.5} 
                                                                value={textSize} 
                                                                onChange={e => setTextSize(parseFloat(e.target.value))}
                                                                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                                            />
                                                        </div>
                                                        <div className="flex flex-col gap-1 items-center">
                                                            <span className="text-[9px] text-white/50 uppercase font-bold tracking-widest">Color</span>
                                                            <input 
                                                                type="color" 
                                                                value={textColor} 
                                                                onChange={e => setTextColor(e.target.value)}
                                                                className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                                                            />
                                                        </div>
                                                        <div className="flex flex-col gap-1 items-center">
                                                            <span className="text-[9px] text-white/50 uppercase font-bold tracking-widest">Outline</span>
                                                            <button onClick={() => setTextStroke(!textStroke)} className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${textStroke ? 'bg-amber-500 border-amber-500 text-black' : 'bg-transparent border-white/30 text-transparent'}`}>
                                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <button 
                                        onClick={() => {
                                            if (!finalVideoRef.current) return;
                                            const canvas = document.createElement('canvas');
                                            canvas.width = finalVideoRef.current.videoWidth || 1920;
                                            canvas.height = finalVideoRef.current.videoHeight || 1080;
                                            canvas.getContext('2d')?.drawImage(finalVideoRef.current, 0, 0, canvas.width, canvas.height);
                                            setThumbnailDataUrl(canvas.toDataURL('image/png'));
                                        }}
                                        className="relative z-10 w-full aspect-video rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-4 hover:border-amber-500/50 hover:bg-amber-500/[0.02] transition-all group/capture"
                                    >
                                        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover/capture:scale-110 group-hover/capture:bg-amber-500/20 transition-all border border-white/5">
                                            <svg className="w-5 h-5 text-neutral-400 group-hover/capture:text-amber-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                        </div>
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 group-hover/capture:text-amber-500 transition-colors">Capture Current Video Frame</span>
                                    </button>
                                )}
                            </div>

                        </div>
                    </div>
                )}
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
