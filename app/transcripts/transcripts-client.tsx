'use client';

import { useState, useEffect } from 'react';
import TranscriptView from './transcript-view';
import VideoPreview from './video-preview';
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
}

interface FinalizedClip {
    clipUrl: string;
    startTime: string;
    endTime: string;
    sourceUrl: string;
    transcript?: string;
}

interface SocialMetadata {
    title: string;
    description: string;
    tags: string[];
    hook: string;
    platform_advice: string;
}

export default function TranscriptsClient({ transcripts, initialQuery, initialAgentResponse }: TranscriptsClientProps) {
    const [selectedTimestamp, setSelectedTimestamp] = useState<{ start: string; end: string; videoUrl?: string } | null>(null);
    const [isMinimized, setIsMinimized] = useState(false);
    const [finalizedClip, setFinalizedClip] = useState<FinalizedClip | null>(null);
    const [socialMeta, setSocialMeta] = useState<SocialMetadata | null>(null);
    const [isGeneratingMeta, setIsGeneratingMeta] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };
    const [processingState, setProcessingState] = useState<{ isOpen: boolean; url: string; engine: 'openai' | 'elevenlabs' }>({
        isOpen: false,
        url: '',
        engine: 'openai'
    });

    useEffect(() => {
        const handleProcessEvent = (e: any) => {
            const { url, engine } = e.detail;
            setProcessingState({ isOpen: true, url, engine });
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

    const defaultVideoUrl = transcripts?.[0]?._source?.filename || undefined;

    return (
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
                                    <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Selected Footage</h1>
                                    <p className="text-xs text-neutral-500 uppercase tracking-widest font-bold">Processed & Ready for Socials</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setFinalizedClip(null)}
                                        className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest border border-white/10"
                                    >
                                        Back to Editor
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
                                    src={finalizedClip.clipUrl}
                                    controls
                                    autoPlay
                                    className="w-full h-full object-contain"
                                />
                                <div className="absolute top-6 left-6 px-4 py-2 bg-rose-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
                                    Final Cut
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
                    />
                )}
            </div>

            {/* Right Column - Secondary Workspace (Preview OR Social Generation) */}
            <div
                className={`flex flex-col h-full min-h-0 transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1) flex-1 overflow-hidden min-w-[300px]`}
            >
                {finalizedClip ? (
                    <div className="flex flex-col h-full glass-card rounded-2xl border-white/10 p-8 animate-fade-in bg-white/[0.02]">
                        <div className="mb-10">
                            <h2 className="text-xl font-bold text-white mb-2">Meta Intelligence</h2>
                            <p className="text-xs text-neutral-500 font-medium">Generate viral hooks and metadata</p>
                        </div>

                        {!socialMeta ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                                <div className="w-20 h-20 mb-8 flex items-center justify-center rounded-3xl bg-white/[0.03] border border-white/10 text-rose-500 animate-pulse">
                                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                <h3 className="text-lg font-bold text-white mb-3">AI Context Engine</h3>
                                <p className="text-sm text-neutral-500 leading-relaxed mb-10 max-w-xs">
                                    Our agent will analyze the segment transcript to generate professional metadata optimized for viral growth.
                                </p>
                                <button
                                    onClick={handleGenerateSocial}
                                    disabled={isGeneratingMeta}
                                    className="w-full py-5 bg-white text-black rounded-2xl font-black uppercase tracking-widest text-[11px] hover:scale-[1.02] active:scale-95 transition-all shadow-2xl shadow-white/5 disabled:opacity-50"
                                >
                                    {isGeneratingMeta ? (
                                        <div className="flex items-center justify-center gap-3">
                                            <div className="w-4 h-4 border-2 border-black/10 border-t-black rounded-full animate-spin" />
                                            Analyzing Content...
                                        </div>
                                    ) : (
                                        "Generate Social Metadata"
                                    )}
                                </button>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar pb-10">
                                {/* Title Block */}
                                <div
                                    onClick={() => copyToClipboard(socialMeta.title, 'title')}
                                    className="group relative space-y-3 cursor-pointer p-6 bg-white/[0.03] border border-white/10 rounded-3xl hover:bg-white/[0.06] hover:border-white/20 transition-all active:scale-[0.99]"
                                >
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500 flex items-center gap-2">
                                            <div className="w-1 h-1 rounded-full bg-rose-500 animate-pulse" />
                                            Suggested Title
                                        </label>
                                        <span className={`text-[9px] font-bold uppercase tracking-widest transition-opacity ${copiedId === 'title' ? 'text-emerald-400 opacity-100' : 'text-neutral-500 opacity-0 group-hover:opacity-100'}`}>
                                            {copiedId === 'title' ? 'Copied!' : 'Click to Copy'}
                                        </span>
                                    </div>
                                    <div className="text-xl text-white font-bold leading-tight pr-4">
                                        {socialMeta.title}
                                    </div>
                                </div>

                                {/* Viral Hook */}
                                <div
                                    onClick={() => copyToClipboard(socialMeta.hook, 'hook')}
                                    className="group relative space-y-3 cursor-pointer p-6 bg-emerald-500/[0.03] border border-emerald-500/10 rounded-3xl hover:bg-emerald-500/[0.08] hover:border-emerald-500/30 transition-all active:scale-[0.99]"
                                >
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500 flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-sm rotate-45" />
                                            Viral Hook
                                        </label>
                                        <span className={`text-[9px] font-bold uppercase tracking-widest transition-opacity ${copiedId === 'hook' ? 'text-emerald-400 opacity-100' : 'text-neutral-500 opacity-0 group-hover:opacity-100'}`}>
                                            {copiedId === 'hook' ? 'Copied!' : 'Click to Copy'}
                                        </span>
                                    </div>
                                    <div className="text-base text-emerald-100 italic font-medium leading-relaxed pr-4">
                                        "{socialMeta.hook}"
                                    </div>
                                </div>

                                {/* Description */}
                                <div
                                    onClick={() => copyToClipboard(socialMeta.description, 'desc')}
                                    className="group relative space-y-3 cursor-pointer p-6 bg-white/[0.02] border border-white/5 rounded-3xl hover:bg-white/[0.05] hover:border-white/10 transition-all active:scale-[0.99]"
                                >
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">Social Description</label>
                                        <span className={`text-[9px] font-bold uppercase tracking-widest transition-opacity ${copiedId === 'desc' ? 'text-emerald-400 opacity-100' : 'text-neutral-500 opacity-0 group-hover:opacity-100'}`}>
                                            {copiedId === 'desc' ? 'Copied!' : 'Click to Copy'}
                                        </span>
                                    </div>
                                    <div className="text-sm text-neutral-400 leading-relaxed font-light pr-4">
                                        {socialMeta.description}
                                    </div>
                                </div>

                                {/* Tags Block */}
                                <div
                                    onClick={() => copyToClipboard(socialMeta.tags.map(t => `#${t}`).join(' '), 'tags')}
                                    className="group relative space-y-4 cursor-pointer p-6 bg-white/[0.01] border border-white/5 rounded-3xl hover:bg-white/[0.03] transition-all"
                                >
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-600">Smart Tags</label>
                                        <span className={`text-[9px] font-bold uppercase tracking-widest transition-opacity ${copiedId === 'tags' ? 'text-emerald-400 opacity-100' : 'text-neutral-500 opacity-0 group-hover:opacity-100'}`}>
                                            {copiedId === 'tags' ? 'Copied All!' : 'Click to Copy All'}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {socialMeta.tags.map((tag, i) => (
                                            <span key={i} className="px-3 py-1.5 rounded-xl bg-white/5 text-[10px] text-neutral-500 font-mono border border-white/5 group-hover:border-white/10 group-hover:text-neutral-300 transition-colors">
                                                #{tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* Expert Analysis Overlay */}
                                <div className="relative p-6 bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 rounded-3xl overflow-hidden group">
                                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-amber-500 opacity-5 blur-3xl rounded-full" />
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500 mb-4 flex items-center gap-2">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Strategy Advice
                                    </h4>
                                    <p className="text-xs text-amber-200/70 leading-relaxed pr-4 font-medium">
                                        {socialMeta.platform_advice}
                                    </p>
                                </div>

                                <button
                                    onClick={() => {
                                        setSocialMeta(null);
                                        handleGenerateSocial();
                                    }}
                                    className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-neutral-600 hover:text-white flex items-center justify-center gap-2 transition-all hover:gap-4"
                                >
                                    <span>Regenerate Intelligence</span>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                    </svg>
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <VideoPreview
                        timestamp={selectedTimestamp}
                        defaultVideoUrl={defaultVideoUrl}
                        onFinalize={handleFinalize}
                        onEditorToggle={(active) => setIsMinimized(active)}
                    />
                )}
            </div>

            {/* In-Workspace Processing Modal */}
            <ProcessingModal
                isOpen={processingState.isOpen}
                videoUrl={processingState.url}
                engine={processingState.engine}
                onClose={() => setProcessingState(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
}
