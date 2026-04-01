'use client';

import { useState, useEffect, useRef } from 'react';

interface VideoPreviewProps {
    timestamp: { start: string; end: string; videoUrl?: string; segments?: { start: string; end: string }[] } | null;
    defaultVideoUrl?: string;
    onFinalize?: (data: { 
        clipUrl: string; 
        startTime: string; 
        endTime: string; 
        sourceUrl: string;
        voiceoverBlocks?: any[];
        captionStyles?: any;
        showCaptions?: boolean;
        muteOriginal?: boolean;
    }) => void;
    onEditorToggle?: (isActive: boolean) => void;
    initialSessionState?: any;
    onSessionUpdate?: (state: any) => void;
}

export default function VideoPreview({ timestamp, defaultVideoUrl, onFinalize, onEditorToggle, initialSessionState, onSessionUpdate }: VideoPreviewProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [clipUrl, setClipUrl] = useState<string | null>(initialSessionState?.clipUrl || null);
    const [error, setError] = useState<string | null>(null);
    const [showFullVideo, setShowFullVideo] = useState(initialSessionState?.showFullVideo || false);
    const [fullVideoUrl, setFullVideoUrl] = useState<string | null>(initialSessionState?.fullVideoUrl || null);
    const [isDownloadingFull, setIsDownloadingFull] = useState(false);
    const [isEditorActive, setIsEditorActive] = useState(initialSessionState?.isEditorActive || false);
    const [trimStart, setTrimStart] = useState(initialSessionState?.trimStart || 0);
    const [trimEnd, setTrimEnd] = useState(initialSessionState?.trimEnd || 60);
    const [videoDuration, setVideoDuration] = useState(0);
    const [isTrimming, setIsTrimming] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [voiceoverBlocks, setVoiceoverBlocks] = useState<any[]>(initialSessionState?.voiceoverBlocks || []);
    const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
    const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
    const [videoSegments, setVideoSegments] = useState<{start: number, end: number}[]>([]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const voiceoverRef = useRef<HTMLAudioElement | null>(null);
    const [activeHandle, setActiveHandle] = useState<string | null>(null);
    const [grabOffset, setGrabOffset] = useState(0); // Offset in seconds from block start
    const [showVoiceEditor, setShowVoiceEditor] = useState(true);
    const [isMagicModalOpen, setIsMagicModalOpen] = useState(false);
    const [magicPrompt, setMagicPrompt] = useState("");
    const [isMagicLoading, setIsMagicLoading] = useState(false);
    const [isGeneratingAll, setIsGeneratingAll] = useState(false);
    const [voices, setVoices] = useState<any[]>([]);
    const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
    const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);
    const [activeSelectionBlockId, setActiveSelectionBlockId] = useState<string | null>(null);
    const [isFinalPreview, setIsFinalPreview] = useState(false);
    const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
    const [preciseTime, setPreciseTime] = useState(0);
    const [magicStatus, setMagicStatus] = useState("Analyzing Multimedia Intelligence");
    const [magicProgress, setMagicProgress] = useState(0);
    const [showCaptions, setShowCaptions] = useState(initialSessionState?.showCaptions ?? true);
    const [muteOriginal, setMuteOriginal] = useState(initialSessionState?.muteOriginal ?? false);
    const [captionStyles, setCaptionStyles] = useState<{
        position: 'top' | 'center' | 'bottom' | 'bottom-flush',
        size: 'xs' | 'small' | 'medium' | 'large',
        color: 'amber' | 'rose' | 'cyan' | 'white',
        theme: 'glass' | 'solid' | 'minimal' | 'transparent',
        width: 'normal' | 'wide' | 'full',
        padding: 'compact' | 'normal' | 'relaxed',
        highlight: boolean
    }>(initialSessionState?.captionStyles || {
        position: 'bottom',
        size: 'medium',
        color: 'amber',
        theme: 'glass',
        width: 'normal',
        padding: 'normal',
        highlight: true
    });
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        let rafId: number;
        const update = () => {
            if (videoRef.current && isPlaying) {
                setPreciseTime(videoRef.current.currentTime);
            }
            rafId = requestAnimationFrame(update);
        };
        update();
        return () => cancelAnimationFrame(rafId);
    }, [isPlaying]);

    useEffect(() => {
        fetch('/api/voices')
            .then(res => res.json())
            .then(data => {
                if (data.voices) setVoices(data.voices);
            })
            .catch(err => console.error('Failed to load voices:', err));
    }, []);

    const parseTime = (s: string) => {
        if (!s) return 0;
        const [hms, ms] = s.split(',');
        const [h, m, sec] = hms.split(':').map(Number);
        return h * 3600 + m * 60 + sec + (ms ? parseInt(ms) / 1000 : 0);
    };

    const handleResetTrim = () => {
        setTrimStart(0);
        setTrimEnd(videoDuration);
        if (videoRef.current) videoRef.current.currentTime = 0;
    };

    const activeVideoUrl = timestamp?.videoUrl || defaultVideoUrl;
    const isYoutube = activeVideoUrl?.includes('youtube.com') || activeVideoUrl?.includes('youtu.be');

    useEffect(() => {
        onSessionUpdate?.({
            voiceoverBlocks,
            trimStart,
            trimEnd,
            captionStyles,
            showCaptions,
            isEditorActive,
            showFullVideo,
            fullVideoUrl,
            clipUrl,
            timestamp,
            muteOriginal
        });
    }, [voiceoverBlocks, trimStart, trimEnd, captionStyles, showCaptions, isEditorActive, showFullVideo, fullVideoUrl, clipUrl, timestamp, muteOriginal, onSessionUpdate]);

    useEffect(() => {
        // Only reset if this is a COMPLETELY new segment coming from the search results
        if (initialSessionState?.timestamp?.start !== timestamp?.start || initialSessionState?.timestamp?.end !== timestamp?.end) {
            setIsEditorActive(false);
            setShowFullVideo(false);
            setFullVideoUrl(null);
            setVoiceoverBlocks([]);
            setTrimStart(0);
            setTrimEnd(videoDuration || 60);
            setVideoSegments([]);
        }

        if (!timestamp || !activeVideoUrl) {
            setClipUrl(null);
            setError(null);
            return;
        }

        const loadClip = async () => {
             // If we already have a clip for this segment in history, use it
            if (initialSessionState?.clipUrl && initialSessionState?.timestamp?.start === timestamp.start && initialSessionState?.timestamp?.end === timestamp.end) {
                setClipUrl(initialSessionState.clipUrl);
                return;
            }

            setIsLoading(true);
            setError(null);
            setClipUrl(null);

            try {
                const isJoining = timestamp.segments && timestamp.segments.length > 0;

                const response = await fetch('/api/clip-video', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        videoUrl: activeVideoUrl,
                        ...(isJoining ? {} : { startTime: timestamp.start, endTime: timestamp.end })
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to create clip');
                
                if (isJoining) {
                    setFullVideoUrl(data.clipUrl);
                    setIsEditorActive(true);
                    onEditorToggle?.(true);
                    
                    const segs = timestamp.segments!.map(s => ({ start: parseTime(s.start), end: parseTime(s.end) })).sort((a,b) => a.start - b.start);
                    setVideoSegments(segs);
                    const s = parseTime(timestamp.start);
                    const e = parseTime(timestamp.end);
                    setTrimStart(s);
                    setTrimEnd(e);
                    if (videoRef.current) {
                        videoRef.current.currentTime = s;
                    }
                } else {
                    setClipUrl(data.clipUrl);
                    setVideoSegments([]);
                }
            } catch (err: any) {
                setError(err.message || 'Failed to load video clip');
            } finally {
                setIsLoading(false);
            }
        };

        loadClip();
    }, [timestamp, activeVideoUrl]);

    const formatSeconds = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},000`;
    };

    const handleApplyTrim = async () => {
        setIsTrimming(true);
        setError(null);
        try {
            const response = await fetch('/api/clip-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrl: activeVideoUrl,
                    startTime: formatSeconds(trimStart),
                    endTime: formatSeconds(trimEnd),
                    voiceoverBlocks: voiceoverBlocks.filter(b => b.filename), // Pass all valid blocks
                    segments: videoSegments.length > 0 ? videoSegments.map(s => ({ start: formatSeconds(s.start), end: formatSeconds(s.end) })) : undefined,
                    captionStyles: captionStyles,
                    showCaptions: showCaptions,
                    muteOriginal: muteOriginal
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to trim video');
            setClipUrl(data.clipUrl);
            setIsFinalPreview(true);
            setIsEditorActive(false);
            onEditorToggle?.(false);
            setShowFullVideo(false);

            // Notify parent about the final cut
            onFinalize?.({
                clipUrl: data.clipUrl,
                startTime: formatSeconds(trimStart),
                endTime: formatSeconds(trimEnd),
                sourceUrl: activeVideoUrl || '',
                voiceoverBlocks: voiceoverBlocks,
                captionStyles: captionStyles,
                showCaptions: showCaptions,
                muteOriginal: muteOriginal
            });
        } catch (err: any) {
            setError(err.message || 'Failed to trim video');
        } finally {
            setIsTrimming(false);
        }
    };

    const handleEditorToggle = async () => {
        if (!isEditorActive) {
            // Opening editor - ensure we have the full video
            if (isYoutube && !fullVideoUrl) {
                setIsDownloadingFull(true);
                setError(null);
                try {
                    const response = await fetch('/api/clip-video', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ videoUrl: activeVideoUrl })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || 'Failed to download full video');
                    setFullVideoUrl(data.clipUrl);
                } catch (err: any) {
                    setError(err.message || 'Failed to download video');
                    setIsDownloadingFull(false);
                    return;
                } finally {
                    setIsDownloadingFull(false);
                }
            }

            // Sync timeline with current segment points
            if (timestamp) {
                const s = parseTime(timestamp.start);
                const e = parseTime(timestamp.end);
                setTrimStart(s);
                setTrimEnd(e);
                setCurrentTime(s);
                // We'll also set the actual video currentTime in onLoadedMetadata or useEffect
            } else {
                setTrimStart(0);
                setTrimEnd(videoDuration || 60);
                setCurrentTime(0);
            }
        }
        const nextEditorState = !isEditorActive;
        setIsEditorActive(nextEditorState);
        onEditorToggle?.(nextEditorState); // Minimize sidebar when Editor is active
        setShowFullVideo(false);
    };

    const handleFullVideoToggle = async () => {
        if (showFullVideo) {
            setShowFullVideo(false);
            return;
        }

        if (isYoutube && !fullVideoUrl) {
            setIsDownloadingFull(true);
            setError(null);
            try {
                const response = await fetch('/api/clip-video', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoUrl: activeVideoUrl })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to download full video');
                setFullVideoUrl(data.clipUrl);
            } catch (err: any) {
                setError(err.message || 'Failed to download video');
                return;
            } finally {
                setIsDownloadingFull(false);
            }
        }

        setShowFullVideo(true);
        setIsEditorActive(false);
        onEditorToggle?.(true); // Minimize sidebar for immersive viewing
    };

    // Ensure playhead is at the start when editor opens or timestamp changes
    useEffect(() => {
        if (isEditorActive && videoRef.current && timestamp) {
            const s = parseTime(timestamp.start);
            videoRef.current.currentTime = s;
        }
    }, [isEditorActive, timestamp]);

    const handleDownload = () => {
        const urlToDownload = showFullVideo ? (fullVideoUrl || (!isYoutube ? activeVideoUrl : null)) : clipUrl;
        if (!urlToDownload) return;
        const link = document.createElement('a');
        link.href = urlToDownload;
        link.download = showFullVideo ? `full_video.mp4` : `clip_${timestamp?.start || 'segment'}_${timestamp?.end || ''}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const calculateDuration = (start: string, end: string) => {
        const dur = parseTime(end) - parseTime(start);
        return isNaN(dur) ? '0' : dur.toFixed(1);
    };

    const handlePlayPause = async () => {
        if (videoRef.current) {
            try {
                if (isPlaying) {
                    videoRef.current.pause();
                    setIsPlaying(false);
                } else {
                    const playPromise = videoRef.current.play();
                    if (playPromise !== undefined) {
                        await playPromise;
                    }
                    setIsPlaying(true);
                }
            } catch (err) {
                console.error("Playback error:", err);
                setIsPlaying(false);
            }
        }
    };

    const handleVolumeChange = (newVolume: number) => {
        setVolume(newVolume);
        if (videoRef.current) {
            videoRef.current.volume = newVolume;
            if (newVolume > 0) {
                setIsMuted(false);
                videoRef.current.muted = false;
            }
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            const newMuteState = !isMuted;
            setIsMuted(newMuteState);
            videoRef.current.muted = newMuteState;
        }
    };

    const onTrimStartChange = (val: number) => {
        const newVal = Math.min(val, trimEnd - 0.5);
        setTrimStart(newVal);
        if (videoSegments.length > 0) {
            setVideoSegments(segs => {
                const newSegs = [...segs];
                newSegs[0].start = newVal;
                return newSegs;
            });
        }
        if (videoRef.current) {
            videoRef.current.currentTime = newVal;
        }
    };

    const onTrimEndChange = (val: number) => {
        const newVal = Math.max(val, trimStart + 0.5);
        setTrimEnd(newVal);
        if (videoSegments.length > 0) {
            setVideoSegments(segs => {
                const newSegs = [...segs];
                newSegs[newSegs.length - 1].end = newVal;
                return newSegs;
            });
        }
        if (videoRef.current) {
            videoRef.current.currentTime = newVal;
        }
    };

    return (
        <div className="h-full flex flex-col glass-card rounded-2xl border-white/10 overflow-hidden relative animate-fade-in shadow-2xl shadow-black/50">
            {/* Minimal Floating Header */}
            <div className="absolute top-6 left-6 right-6 flex items-start justify-between z-40 pointer-events-none">
                <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-4 pointer-events-auto">
                    <h2 className="text-sm font-bold tracking-widest uppercase text-white mb-1">
                        {isEditorActive ? 'Pro Editor' : showFullVideo ? 'Full Video' : 'Segment'}
                    </h2>
                    <div className="flex items-center gap-3 text-xs text-neutral-400 font-medium">
                        <span>
                            {isEditorActive
                                ? `${(trimEnd - trimStart).toFixed(1)}s Edit Window`
                                : showFullVideo
                                    ? 'Source Stream'
                                    : (timestamp ? `${timestamp.start} — ${timestamp.end} (${calculateDuration(timestamp.start, timestamp.end)}s)` : 'Awaiting Selection')
                            }
                        </span>
                    </div>
                </div>

                <div className="flex gap-2 pointer-events-auto">
                    {(clipUrl || fullVideoUrl || (!isYoutube && activeVideoUrl)) && (
                        <>
                            <button
                                onClick={handleEditorToggle}
                                className={`w-10 h-10 glass-button rounded-lg flex items-center justify-center transition-all border ${isEditorActive ? 'bg-amber-500 text-black border-amber-400' : 'bg-white/[0.03] text-amber-500 border-amber-500/20'}`}
                                title="Timeline Editor"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                            <button
                                onClick={handleFullVideoToggle}
                                disabled={isDownloadingFull}
                                className={`w-10 h-10 glass-button rounded-lg flex items-center justify-center transition-all border ${showFullVideo ? 'bg-rose-500 text-white border-rose-400' : 'bg-white/[0.03] text-rose-400 border-rose-500/20'} ${isDownloadingFull ? 'animate-pulse opacity-50' : ''}`}
                                title={showFullVideo ? "Switch to Segment" : "Play Full Video"}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    {showFullVideo ? (
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                    ) : (
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    )}
                                </svg>
                            </button>
                            {clipUrl && !isEditorActive && !showFullVideo && (
                                <button
                                    onClick={() => onFinalize?.({
                                        clipUrl: clipUrl,
                                        startTime: timestamp?.start || '00:00:00,000',
                                        endTime: timestamp?.end || '00:00:10,000',
                                        sourceUrl: activeVideoUrl || '',
                                        voiceoverBlocks: voiceoverBlocks,
                                        captionStyles: captionStyles,
                                        showCaptions: showCaptions,
                                        muteOriginal: muteOriginal
                                    })}
                                    className="px-6 h-10 bg-gradient-to-r from-rose-600 to-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(225,29,72,0.4)] border border-rose-500/50 flex items-center gap-2"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Finalize Segment
                                </button>
                            )}
                        </>
                    )}
                    {timestamp && (
                        <a
                            href={activeVideoUrl ? `${activeVideoUrl}${activeVideoUrl.includes('?') ? '&' : '?'}t=${(() => {
                                const parts = timestamp.start.split(':').map(Number);
                                return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]);
                            })()}s` : '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-10 h-10 glass-button rounded-lg flex items-center justify-center bg-white/[0.03]"
                            title="Open on YouTube"
                        >
                            <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                            </svg>
                        </a>
                    )}
                    {((showFullVideo && (fullVideoUrl || !isYoutube)) || (!showFullVideo && clipUrl)) && !isLoading && !isDownloadingFull && !isEditorActive && (
                        <button
                            onClick={handleDownload}
                            className="w-10 h-10 glass-button rounded-lg flex items-center justify-center bg-white/[0.05] border border-white/10 text-white hover:bg-white hover:text-black transition-all"
                            title={showFullVideo ? "Download Full Video" : "Download Segment"}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* SYNC ENGINE: For multi-track audio preview */}
            <SyncAudioPreview 
                isPlaying={isPlaying} 
                currentTime={currentTime} 
                trimStart={trimStart} 
                blocks={voiceoverBlocks} 
            />

            {/* Video Viewport */}
            <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
                {!timestamp && !showFullVideo && !isDownloadingFull && !isEditorActive ? (
                    <div className="flex flex-col items-center justify-center px-10 text-center animate-fade-in group">
                        <div className="w-20 h-20 mb-8 flex items-center justify-center glass-card rounded-[2rem] border-white/10 opacity-40 group-hover:opacity-100 group-hover:scale-110 group-hover:rotate-12 transition-all duration-700 bg-gradient-to-br from-white/5 to-transparent">
                            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </div>

                        <h3 className="text-lg font-bold text-white mb-2 tracking-tight">
                            {activeVideoUrl ? 'Source Ingested' : 'No Active Video'}
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.3em] font-black text-rose-500/50 mb-6">
                            {activeVideoUrl ? 'Awaiting Segment Isolation' : 'Waiting for Ingestion'}
                        </p>

                        <div className="flex flex-col gap-6 items-center w-full max-w-sm">
                            <div className="w-full flex items-center gap-3 px-6 py-4 bg-white/[0.02] border border-white/5 rounded-2xl backdrop-blur-3xl animate-pulse">
                                <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,1)] flex-shrink-0" />
                                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest truncate">
                                    {activeVideoUrl || 'System Ready: Paste a URL above to begin'}
                                </span>
                            </div>

                            <button
                                onClick={handleFullVideoToggle}
                                disabled={!activeVideoUrl || isDownloadingFull}
                                className={`px-10 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-2xl flex items-center gap-4 ${!activeVideoUrl
                                    ? 'bg-neutral-900 text-neutral-700 border border-white/5 cursor-not-allowed'
                                    : 'bg-white text-black hover:scale-105 active:scale-95 shadow-white/5'
                                    }`}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                </svg>
                                Watch Full Video
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-black relative">
                        {(isLoading || isDownloadingFull || isTrimming) ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md z-50 transition-all duration-500">
                                <div className="w-10 h-10 border-2 border-white/10 border-t-white rounded-full animate-spin mb-4"></div>
                                <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-neutral-500 text-center px-6">
                                    {isTrimming ? 'Applying Professional Cuts' : isDownloadingFull ? 'Downloading Full Stream' : 'Processing Segment'}
                                </span>
                            </div>
                        ) : error ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-red-900/10 z-10">
                                <p className="text-xs text-red-400 font-medium mb-2">{error}</p>
                                <p className="text-[8px] text-red-400/50 uppercase tracking-widest">Error Occurred</p>
                            </div>
                        ) : isEditorActive ? (
                        <div 
                            className="w-full h-full flex flex-col bg-neutral-950 p-6 overflow-y-auto custom-scrollbar select-none pt-10"
                            onClick={() => setActiveBlockId(null)}
                        >
                            {/* Pro-Editor Navigation */}
                            <div className="flex items-center justify-center mb-8 px-2">
                                <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                                    <button 
                                        onClick={() => setShowVoiceEditor(true)}
                                        className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${showVoiceEditor ? 'bg-white text-black shadow-lg shadow-white/5' : 'text-neutral-500 hover:text-white'}`}
                                    >
                                        Voiceover Suite
                                    </button>
                                    <button 
                                        onClick={() => setShowVoiceEditor(false)}
                                        className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${!showVoiceEditor ? 'bg-white text-black shadow-lg shadow-white/5' : 'text-neutral-500 hover:text-white'}`}
                                    >
                                        Visual Preview Only
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-6 h-full min-h-[400px]">
                                    {/* Left: Video Preview */}
                                    <div className="flex-[1.4] relative rounded-xl border border-white/5 overflow-hidden group bg-black shadow-inner flex items-center justify-center">
                                        <video
                                            ref={videoRef}
                                            src={fullVideoUrl || (!isYoutube ? activeVideoUrl : undefined)}
                                            onLoadedMetadata={(e) => {
                                                const duration = e.currentTarget.duration;
                                                setVideoDuration(duration);
                                                if (!timestamp) {
                                                    setTrimEnd(duration);
                                                } else {
                                                    const s = parseTime(timestamp.start);
                                                    e.currentTarget.currentTime = s;
                                                }
                                            }}
                                            onPlay={() => {
                                                setIsPlaying(true);
                                                if (voiceoverRef.current) {
                                                    voiceoverRef.current.currentTime = 0;
                                                    voiceoverRef.current.play().catch(() => {});
                                                }
                                            }}
                                            onPause={() => {
                                                setIsPlaying(false);
                                                if (voiceoverRef.current) voiceoverRef.current.pause();
                                            }}
                                            onTimeUpdate={(e) => {
                                                const time = e.currentTarget.currentTime;
                                                setCurrentTime(time);
                                                // Strict Loop/Clamp/Skip Logic
                                                if (isEditorActive) {
                                                    if (videoSegments.length > 1) {
                                                        let inSegment = false;
                                                        for (let i = 0; i < videoSegments.length; i++) {
                                                            const seg = videoSegments[i];
                                                            if (time >= seg.start && time <= seg.end) {
                                                                inSegment = true;
                                                                break;
                                                            } else if (time > seg.end && i < videoSegments.length - 1 && time < videoSegments[i+1].start) {
                                                                e.currentTarget.currentTime = videoSegments[i+1].start;
                                                                inSegment = true;
                                                                break;
                                                            }
                                                        }
                                                        if (!inSegment) {
                                                            if (time > videoSegments[videoSegments.length-1].end) {
                                                                e.currentTarget.currentTime = videoSegments[0].start;
                                                                if (!isPlaying) e.currentTarget.pause();
                                                            } else if (time < videoSegments[0].start) {
                                                                e.currentTarget.currentTime = videoSegments[0].start;
                                                            }
                                                        }
                                                    } else {
                                                        if (time < trimStart) {
                                                            e.currentTarget.currentTime = trimStart;
                                                        } else if (time > trimEnd) {
                                                            e.currentTarget.currentTime = trimStart;
                                                            if (!isPlaying) e.currentTarget.pause();
                                                        }
                                                    }
                                                }
                                            }}
                                            className="max-w-full max-h-full object-contain cursor-pointer"
                                            onClick={handlePlayPause}
                                            muted={muteOriginal || isMuted}
                                        />

                                        {/* Dynamic Captions Overlay (Styled) */}
                                        {showCaptions && (
                                            <div className={`absolute inset-0 flex items-center justify-center pointer-events-none px-12 z-20 ${
                                                captionStyles.position === 'top' ? 'items-start pt-20' : 
                                                captionStyles.position === 'center' ? 'items-center' : 
                                                captionStyles.position === 'bottom-flush' ? 'items-end pb-8' :
                                                'items-end pb-24'
                                            }`}>
                                                {voiceoverBlocks
                                                    .filter(b => b.text.trim())
                                                    .map(block => {
                                                        const activeVideoTime = isPlaying ? preciseTime : currentTime;
                                                        const clipTime = isFinalPreview ? activeVideoTime : activeVideoTime - trimStart;
                                                        const offsetInBlock = clipTime - block.startTime;
                                                        const words = block.text.split(' ');
                                                        
                                                        if (clipTime >= block.startTime && clipTime <= (block.startTime + (block.duration || 4))) {
                                                            return (
                                                                <div key={block.id} className={`text-center animate-in zoom-in-95 fade-in duration-300 ${
                                                                    captionStyles.width === 'full' ? 'w-full' : captionStyles.width === 'wide' ? 'max-w-4xl' : 'max-w-2xl'
                                                                } ${
                                                                    captionStyles.position === 'top' ? 'slide-in-from-top-2' : 
                                                                    captionStyles.position === 'bottom' ? 'slide-in-from-bottom-2' : ''
                                                                }`}>
                                                                    <div className={`rounded-2xl transition-all shadow-2xl ${
                                                                        captionStyles.padding === 'compact' ? 'px-6 py-2' : 
                                                                        captionStyles.padding === 'relaxed' ? 'px-12 py-8' : 'px-8 py-4'
                                                                    } ${
                                                                        captionStyles.theme === 'glass' ? 'bg-black/70 backdrop-blur-3xl border border-white/10' : 
                                                                        captionStyles.theme === 'solid' ? 'bg-black border border-white/20' : 
                                                                        captionStyles.theme === 'minimal' ? 'bg-black/40 border border-white/5' :
                                                                        'bg-transparent shadow-none border-none'
                                                                    }`}>
                                                                        <p className={`font-black text-white leading-tight tracking-tight drop-shadow-lg transition-all ${
                                                                            captionStyles.size === 'xs' ? 'text-[11px] sm:text-xs tracking-widest uppercase' :
                                                                            captionStyles.size === 'small' ? 'text-lg' : 
                                                                            captionStyles.size === 'large' ? 'text-3xl' : 
                                                                            'text-xl sm:text-2xl'
                                                                        }`}>
                                                                            {captionStyles.highlight ? (
                                                                                (() => {
                                                                                    const activeRefColor = captionStyles.color === 'amber' ? 'text-amber-500' : captionStyles.color === 'rose' ? 'text-rose-500' : captionStyles.color === 'cyan' ? 'text-cyan-400' : 'text-white underline';
                                                                                    const activeGlow = captionStyles.color === 'amber' ? 'rgba(245,158,11,0.5)' : captionStyles.color === 'rose' ? 'rgba(244,63,94,0.5)' : captionStyles.color === 'cyan' ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.5)';
                                                                                    const clipTime = (isPlaying ? preciseTime : currentTime) - trimStart;
                                                                                    const offsetInBlock = clipTime - block.startTime;
                                                                                    const words = block.text.split(' ');
                                                                                    
                                                                                    // Use ElevenLabs alignment if available
                                                                                    if (block.alignment && block.alignment.characters) {
                                                                                        const chars = block.alignment.characters;
                                                                                        const starts = block.alignment.character_start_times_seconds;
                                                                                        
                                                                                        // Find current character index based on elapsed block time
                                                                                        let activeCharIdx = -1;
                                                                                        for (let i = 0; i < starts.length; i++) {
                                                                                            if (offsetInBlock >= starts[i]) {
                                                                                                activeCharIdx = i;
                                                                                            } else {
                                                                                                break;
                                                                                            }
                                                                                        }
                                                                                        
                                                                                        // Map character index to word index
                                                                                        let currentWordIdx = 0;
                                                                                        let charTraversed = 0;
                                                                                        let activeWordIdx = -1;

                                                                                        words.forEach((word: string, wIdx: number) => {
                                                                                            const wordRangeStart = charTraversed;
                                                                                            const wordRangeEnd = charTraversed + word.length;
                                                                                            if (activeCharIdx >= wordRangeStart && activeCharIdx < wordRangeEnd) {
                                                                                                activeWordIdx = wIdx;
                                                                                            }
                                                                                            charTraversed += word.length + 1; // +1 for space
                                                                                        });

                                                                                        return words.map((word: string, i: number) => (
                                                                                            <span key={i} className={`transition-all duration-300 ${i === activeWordIdx ? `${activeRefColor} scale-110 drop-shadow-[0_0_10px_${activeGlow}]` : 'opacity-30'}`}>
                                                                                                {word}{' '}
                                                                                            </span>
                                                                                        ));
                                                                                    }
                                                                                    
                                                                                    // Fallback: Estimation
                                                                                    const timePerWord = (block.duration || 4) / words.length;
                                                                                    const activeIndex = Math.floor(offsetInBlock / timePerWord);
                                                                                    return words.map((word: string, i: number) => (
                                                                                        <span key={i} className={`transition-all duration-300 ${i === activeIndex ? activeRefColor : 'opacity-30'}`}>
                                                                                            {word}{' '}
                                                                                        </span>
                                                                                    ));
                                                                                })()
                                                                            ) : block.text}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })}
                                            </div>
                                        )}

                                        <div className="absolute inset-x-0 bottom-1 p-4 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-30">
                                            <div className="flex items-center gap-4">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
                                                    className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center hover:bg-white hover:text-black transition-all"
                                                >
                                                    {isPlaying ? 
                                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : 
                                                        <svg className="w-4 h-4 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                    }
                                                </button>
                                                <div className="text-[10px] font-mono text-neutral-400">
                                                    {Math.floor(currentTime / 60)}:{(currentTime % 60).toFixed(0).padStart(2, '0')} / {Math.floor(videoDuration / 60)}:{(videoDuration % 60).toFixed(0).padStart(2, '0')}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                {/* Caption Style Menu */}
                                                <div className="flex bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setCaptionStyles(s => ({ ...s, position: s.position === 'bottom' ? 'bottom-flush' : s.position === 'bottom-flush' ? 'top' : s.position === 'top' ? 'center' : 'bottom'})); }}
                                                        className="w-10 h-10 flex items-center justify-center text-neutral-500 hover:text-white transition-all border-r border-white/5"
                                                        title="Position"
                                                    >
                                                        <svg className={`w-4 h-4 transition-transform ${captionStyles.position === 'top' ? '-rotate-180' : captionStyles.position === 'center' ? 'rotate-90' : captionStyles.position === 'bottom-flush' ? 'rotate-180 opacity-50' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7m14-8l-7 7-7-7" /></svg>
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setCaptionStyles(s => ({ ...s, size: s.size === 'xs' ? 'small' : s.size === 'small' ? 'medium' : s.size === 'medium' ? 'large' : 'xs'})); }}
                                                        className="w-10 h-10 flex items-center justify-center text-[10px] font-black uppercase text-neutral-500 hover:text-white transition-all border-r border-white/5"
                                                        title="Size"
                                                    >
                                                        {captionStyles.size.toUpperCase().slice(0, 2)}
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setCaptionStyles(s => ({ ...s, color: s.color === 'amber' ? 'rose' : s.color === 'rose' ? 'cyan' : s.color === 'cyan' ? 'white' : 'amber'})); }}
                                                        className="w-10 h-10 flex items-center justify-center transition-all border-r border-white/5"
                                                        title="Highlight Color"
                                                    >
                                                        <div className={`w-3 h-3 rounded-full border border-white/20 ${captionStyles.color === 'amber' ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : captionStyles.color === 'rose' ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : captionStyles.color === 'cyan' ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]' : 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]'}`} />
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setCaptionStyles(s => ({ ...s, theme: s.theme === 'glass' ? 'solid' : s.theme === 'solid' ? 'minimal' : s.theme === 'minimal' ? 'transparent' : 'glass'})); }}
                                                        className="w-10 h-10 flex items-center justify-center text-neutral-500 hover:text-white transition-all border-r border-white/5"
                                                        title="Theme"
                                                    >
                                                        <div className={`w-3 h-3 rounded-full border-2 border-current transition-colors ${captionStyles.theme === 'solid' ? 'bg-current' : captionStyles.theme === 'minimal' ? 'border-dashed' : captionStyles.theme === 'transparent' ? 'border-dotted' : ''}`} />
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setCaptionStyles(s => ({ ...s, width: s.width === 'normal' ? 'wide' : s.width === 'wide' ? 'full' : 'normal'})); }}
                                                        className="w-10 h-10 flex items-center justify-center text-neutral-500 hover:text-white transition-all border-r border-white/5"
                                                        title="Width"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 5h8m-8 5h8m-4-10V3m0 18v-4" /></svg>
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setCaptionStyles(s => ({ ...s, padding: s.padding === 'normal' ? 'compact' : s.padding === 'compact' ? 'relaxed' : 'normal'})); }}
                                                        className="w-10 h-10 flex items-center justify-center text-neutral-500 hover:text-white transition-all border-r border-white/5"
                                                        title="Height (Padding)"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setCaptionStyles(s => ({ ...s, highlight: !s.highlight })); }}
                                                        className={`w-10 h-10 flex items-center justify-center transition-all ${captionStyles.highlight ? 'text-amber-500' : 'text-neutral-500 hover:text-white'}`}
                                                        title="Word Highlighting"
                                                    >
                                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                                                    </button>
                                                </div>

                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); setMuteOriginal(!muteOriginal); }}
                                                    className={`w-10 h-10 rounded-xl border transition-all flex items-center justify-center ${muteOriginal ? 'bg-rose-500 text-white border-rose-500 shadow-lg shadow-rose-500/20' : 'bg-black/40 backdrop-blur-xl border-white/10 text-white/40 hover:text-white'}`}
                                                    title={muteOriginal ? "Unmute Original Video" : "Mute Original Video"}
                                                >
                                                    {muteOriginal ? (
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                                        </svg>
                                                    )}
                                                </button>

                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); setShowCaptions(!showCaptions); }}
                                                    className={`w-10 h-10 rounded-xl border transition-all flex flex-col items-center justify-center gap-0.5 ${showCaptions ? 'bg-amber-500 text-black border-amber-500 shadow-lg shadow-amber-500/20' : 'bg-black/40 backdrop-blur-xl border-white/10 text-white/40 hover:text-white'}`}
                                                >
                                                    <span className="text-[9px] font-black leading-none uppercase">CC</span>
                                                    <div className={`w-3 h-0.5 rounded-full transition-all ${showCaptions ? 'bg-black/40' : 'bg-white/20'}`} />
                                                </button>
                                            </div>
                                        </div>
                                        {!isPlaying && (
                                            <button
                                                onClick={handlePlayPause}
                                                className="absolute w-12 h-12 bg-white/10 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-2xl z-20"
                                            >
                                                <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>

                                    {/* AI Voiceover Suite (Toggleable) */}
                                    {showVoiceEditor && (
                                        <div className="flex-[1.6] flex flex-col gap-6 p-6 bg-white/[0.02] border border-white/10 rounded-2xl backdrop-blur-3xl overflow-y-auto animate-in fade-in slide-in-from-right-4 duration-300">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Voice Timeline</h3>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (isGeneratingAll) return;
                                                            setIsGeneratingAll(true);
                                                            try {
                                                                const pendingBlocks = voiceoverBlocks.filter(b => !b.audioUrl && b.text.trim());
                                                                const updatedBlocks = [...voiceoverBlocks];

                                                                for (const block of pendingBlocks) {
                                                                    const res = await fetch('/api/synthesize', {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ 
                                                                            text: block.text,
                                                                            voiceId: block.voiceId || defaultVoiceId 
                                                                        })
                                                                    });
                                                                    const data = await res.json();
                                                                    if (data.audioUrl) {
                                                                        const idx = updatedBlocks.findIndex(b => b.id === block.id);
                                                                        updatedBlocks[idx] = { 
                                                                            ...updatedBlocks[idx], 
                                                                            audioUrl: data.audioUrl, 
                                                                            filename: data.filename,
                                                                            alignment: data.alignment
                                                                        };
                                                                        setVoiceoverBlocks([...updatedBlocks]); // Update progressively
                                                                    }
                                                                }
                                                            } catch (err) {
                                                                console.error('Batch synthesis failed:', err);
                                                            } finally {
                                                                setIsGeneratingAll(false);
                                                            }
                                                        }}
                                                        disabled={isGeneratingAll || !defaultVoiceId || !voiceoverBlocks.some(b => !b.audioUrl && b.text.trim())}
                                                        className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-[9px] font-black uppercase rounded-lg hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-30 flex items-center gap-2 group"
                                                    >
                                                        {isGeneratingAll ? <div className="w-3 h-3 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" /> : <svg className="w-3 h-3 transition-transform group-hover:scale-125" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                                                        Generate All
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setActiveSelectionBlockId(null); setIsVoiceModalOpen(true); }}
                                                        className="px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 text-purple-500 text-[9px] font-black uppercase rounded-lg hover:bg-purple-500 hover:text-white transition-all transition-colors flex items-center gap-2 group"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                                                        {voices.find(v => v.id === defaultVoiceId)?.name.split(' ')[0] || 'Vocal'}
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setIsMagicModalOpen(true); }}
                                                        className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[9px] font-black uppercase rounded-lg hover:bg-amber-500 hover:text-white transition-all transition-colors flex items-center gap-2 group"
                                                    >
                                                        <svg className="w-3 h-3 group-hover:rotate-12 transition-transform" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/></svg>
                                                        Magic Script
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            let proposedStart = Math.max(0, currentTime - trimStart);
                                                            const sorted = [...voiceoverBlocks].sort((a,b) => a.startTime - b.startTime);
                                                            
                                                            // Robust Gap Finding Sweep
                                                            let overlapFound = true;
                                                            while (overlapFound) {
                                                                overlapFound = false;
                                                                for (const b of sorted) {
                                                                    const bEnd = b.startTime + (b.duration || 2);
                                                                    // If proposed window overlaps this block
                                                                    if (proposedStart < bEnd && (proposedStart + 2) > b.startTime) {
                                                                        proposedStart = bEnd;
                                                                        overlapFound = true;
                                                                        break; // Start check again from new proposed start to handle sequential blocks
                                                                    }
                                                                }
                                                            }

                                                            const newBlock = {
                                                                id: `v_${Date.now()}`,
                                                                text: '',
                                                                startTime: proposedStart,
                                                                duration: 2,
                                                                voiceId: defaultVoiceId
                                                            };
                                                            setVoiceoverBlocks(prev => [...prev, newBlock]);
                                                            setActiveBlockId(newBlock.id);
                                                        }}
                                                        className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[9px] font-black uppercase rounded-lg hover:bg-rose-500 hover:text-white transition-all transition-colors flex items-center gap-2 group"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                                                        Script
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
                                                {voiceoverBlocks.length === 0 ? (
                                                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/5 rounded-2xl opacity-40">
                                                        <p className="text-[10px] uppercase font-bold text-neutral-500 tracking-widest leading-relaxed">
                                                            No narrations yet.<br/>
                                                            Add a block at the current time.
                                                        </p>
                                                    </div>
                                                ) : (
                                                    voiceoverBlocks.map((block) => (
                                                        <div
                                                            key={block.id}
                                                            className={`p-4 rounded-xl border transition-all ${activeBlockId === block.id ? 'bg-white/[0.05] border-amber-500/50 shadow-lg shadow-amber-500/5' : block.audioUrl ? 'bg-emerald-500/5 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.05)]' : 'bg-white/[0.02] border-white/5 hover:border-white/10'}`}
                                                            onClick={(e) => { e.stopPropagation(); setActiveBlockId(block.id); }}
                                                        >
                                                            <div className="flex items-center justify-between mb-3">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[9px] font-mono text-neutral-500">@{block.startTime.toFixed(2)}s</span>
                                                                        {block.audioUrl && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />}
                                                                    </div>
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); setActiveSelectionBlockId(block.id); setIsVoiceModalOpen(true); }}
                                                                        className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 border border-white/5 hover:border-white/20 hover:bg-white/10 rounded transition-all group/vsel"
                                                                    >
                                                                        <svg className="w-2.5 h-2.5 text-neutral-500 group-hover/vsel:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                                                                        <span className="text-[8px] font-black uppercase tracking-widest text-neutral-400 group-hover/vsel:text-white">
                                                                            {voices.find(v => v.id === (block.voiceId || defaultVoiceId))?.name.split(' ')[0] || 'Vocal'}
                                                                        </span>
                                                                    </button>
                                                                </div>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setVoiceoverBlocks(voiceoverBlocks.filter(b => b.id !== block.id));
                                                                        if (activeBlockId === block.id) setActiveBlockId(null);
                                                                    }}
                                                                    className="text-neutral-600 hover:text-rose-500 transition-colors"
                                                                >
                                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                </button>
                                                            </div>

                                                            {activeBlockId === block.id ? (
                                                                <div className="flex flex-col gap-3">
                                                                    <textarea
                                                                        value={block.text}
                                                                        onChange={(e) => {
                                                                            const text = e.target.value;
                                                                            const words = text.split(/\s+/).filter(Boolean).length;
                                                                            const estimatedDuration = Math.max(1, words / 2.5);
                                                                            setVoiceoverBlocks(voiceoverBlocks.map(b => b.id === block.id ? { ...b, text, duration: estimatedDuration } : b));
                                                                        }}
                                                                        placeholder="Voiceover script..."
                                                                        className="bg-black/40 border border-white/10 rounded-lg p-3 text-[11px] text-white outline-none resize-none h-20"
                                                                    />
                                                                    <button
                                                                        onClick={async (e) => {
                                                                            e.stopPropagation();
                                                                            if (!block.text.trim() || isGeneratingVoice) return;
                                                                            setIsGeneratingVoice(true);
                                                                            try {
                                                                                const res = await fetch('/api/synthesize', {
                                                                                    method: 'POST',
                                                                                    headers: { 'Content-Type': 'application/json' },
                                                                                    body: JSON.stringify({ 
                                                                                        text: block.text,
                                                                                        voiceId: block.voiceId || defaultVoiceId
                                                                                    })
                                                                                });
                                                                                const data = await res.json();
                                                                                if (data.audioUrl) {
                                                                                    // Probe audio for absolute duration
                                                                                    const audio = new Audio(data.audioUrl);
                                                                                    audio.onloadedmetadata = () => {
                                                                                       setVoiceoverBlocks(blocks => blocks.map(b => b.id === block.id ? { 
                                                                                            ...b, 
                                                                                            audioUrl: data.audioUrl, 
                                                                                            filename: data.filename,
                                                                                            duration: audio.duration,
                                                                                            alignment: data.alignment
                                                                                        } : b));
                                                                                    };
                                                                                    // Auto-confirm and exit edit mode after successful synthesis
                                                                                    setActiveBlockId(null);
                                                                                }
                                                                            } catch (err) {
                                                                                console.error('Synthesis failed:', err);
                                                                            } finally {
                                                                                setIsGeneratingVoice(false);
                                                                            }
                                                                        }}
                                                                        disabled={!block.text.trim() || isGeneratingVoice || !(block.voiceId || defaultVoiceId)}
                                                                        className="w-full py-2 bg-white text-black text-[9px] font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2"
                                                                    >
                                                                        {isGeneratingVoice ? <div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : "Synthesize"}
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <p className="text-[11px] text-neutral-400 line-clamp-2 italic">
                                                                    {block.text || "No script added..."}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Timeline Layer for Audio Tracks (Centered Production Zone) - Toggleable */}
                                {showVoiceEditor && (
                                    <div className="h-16 mt-6 mx-4 bg-white/[0.02] border border-white/5 rounded-2xl relative flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                                        <div className="absolute inset-0 bg-amber-500/5 px-10 flex items-center pointer-events-none">
                                            <span className="text-[8px] font-black uppercase text-amber-500 tracking-[0.2em] opacity-40">Voice Layer</span>
                                        </div>

                                        <div 
                                            className="flex-1 relative mx-6 cursor-crosshair group/vtrack"
                                            onMouseMove={(e) => {
                                                if (activeHandle === 'voice-drag' && activeBlockId) {
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    const x = e.clientX - rect.left;
                                                    const trackWidth = rect.width;
                                                    const percentage = Math.max(0, Math.min(1, x / trackWidth));
                                                    const pointerTime = percentage * (trimEnd - trimStart);
                                                    
                                                    const activeBlock = voiceoverBlocks.find(b => b.id === activeBlockId);
                                                    if (!activeBlock) return;

                                                    const duration = activeBlock.duration || 1; 
                                                    const otherBlocks = voiceoverBlocks.filter(b => b.id !== activeBlockId).sort((a,b) => a.startTime - b.startTime);

                                                    // Proposed new start time accounting for where you grabbed it
                                                    let proposedTime = pointerTime - grabOffset;

                                                    // Dynamic Obstacle Detection based on proposed path
                                                    const leftObstacles = otherBlocks.filter(b => (b.startTime + (b.duration || 1)) <= activeBlock.startTime);
                                                    const rightObstacles = otherBlocks.filter(b => b.startTime >= (activeBlock.startTime + duration));

                                                    const nearestLeft = leftObstacles.length > 0 ? leftObstacles[leftObstacles.length - 1] : null;
                                                    const nearestRight = rightObstacles.length > 0 ? rightObstacles[0] : null;

                                                    if (nearestLeft) {
                                                        proposedTime = Math.max(proposedTime, nearestLeft.startTime + (nearestLeft.duration || 1));
                                                    }
                                                    if (nearestRight) {
                                                        proposedTime = Math.min(proposedTime, nearestRight.startTime - duration);
                                                    }

                                                    // Hard Track Boundaries
                                                    const maxPossibleTime = (trimEnd - trimStart) - duration;
                                                    proposedTime = Math.max(0, Math.min(proposedTime, maxPossibleTime));

                                                    setVoiceoverBlocks(blocks => blocks.map(b => b.id === activeBlockId ? { ...b, startTime: proposedTime } : b));
                                                }
                                            }}
                                            onMouseUp={() => activeHandle === 'voice-drag' && setActiveHandle(null)}
                                            onMouseLeave={() => activeHandle === 'voice-drag' && setActiveHandle(null)}
                                        >
                                            {/* Draggable Audio Blocks (Now Absolute to the mx-6 Track) */}
                                            {voiceoverBlocks.map(block => (
                                                <div
                                                    key={block.id}
                                                    onMouseDown={(e) => {
                                                        e.stopPropagation();
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        const clickPercentage = (e.clientX - rect.left) / rect.width;
                                                        // Store how many seconds deep into the block we clicked
                                                        const durationInBlock = (block.duration || 1) * clickPercentage;
                                                        setGrabOffset(durationInBlock);
                                                        
                                                        setActiveBlockId(block.id);
                                                        setActiveHandle('voice-drag');
                                                    }}
                                                    className={`absolute top-1/2 h-9 -translate-y-1/2 rounded-lg border-2 flex items-center justify-center cursor-move transition-shadow ${activeBlockId === block.id ? 'bg-amber-500 border-white shadow-[0_0_15px_rgba(245,158,11,0.6)] z-20' : 'bg-amber-500/20 border-amber-500/40 hover:bg-amber-500/40 hover:border-amber-500/60 z-10'}`}
                                                    style={{
                                                        left: `${(block.startTime / (trimEnd - trimStart || 1)) * 100}%`,
                                                        width: `${((block.duration || 1) / (trimEnd - trimStart || 1)) * 100}%`,
                                                        minWidth: '40px'
                                                    }}
                                                >
                                                    <div className={`w-1.5 h-1.5 rounded-full mr-2 ${block.filename ? 'bg-white' : 'bg-white/40 animate-pulse'}`} />
                                                    <div className="text-[8px] font-black text-amber-950 uppercase truncate max-w-[80px]">
                                                        v_{block.id.slice(-4)}
                                                    </div>
                                                </div>
                                            ))}

                                            {/* Precision Matched Playhead */}
                                            <div
                                                className="absolute top-0 bottom-0 w-[1px] bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,1)] z-30 pointer-events-none"
                                                style={{ left: `${((currentTime - trimStart) / (trimEnd - trimStart || 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="h-40 flex flex-col justify-center gap-6 mt-4 px-4 overflow-visible">
                                    <div className="relative h-12 bg-white/5 rounded-full border border-white/10 flex items-center px-6 shadow-inner">
                                        <div className="absolute inset-x-6 h-1 bg-white/10 rounded-full" />
                                        
                                        {(() => {
                                            const viewStart = isEditorActive ? trimStart : 0;
                                            const viewEnd = isEditorActive ? trimEnd : (videoDuration || 100);
                                            const viewRange = viewEnd - viewStart || 1;

                                            return (
                                                <div className="absolute inset-x-6 h-full flex items-center pointer-events-none">
                                                    {videoSegments.length > 0 ? (
                                                        videoSegments.flatMap((seg, i) => [
                                                            <input
                                                                key={`in-s-${i}`}
                                                                type="range"
                                                                min={viewStart}
                                                                max={viewEnd}
                                                                step={0.1}
                                                                value={seg.start}
                                                                onMouseDown={() => setActiveHandle(`seg-${i}-start`)}
                                                                onTouchStart={() => setActiveHandle(`seg-${i}-start`)}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value);
                                                                    const maxAllowed = seg.end - 0.5;
                                                                    const minAllowed = i > 0 ? videoSegments[i-1].end + 0.5 : 0;
                                                                    const bounded = Math.max(minAllowed, Math.min(val, maxAllowed));
                                                                    
                                                                    setVideoSegments(segs => {
                                                                        const newSegs = [...segs];
                                                                        newSegs[i].start = bounded;
                                                                        return newSegs;
                                                                    });
                                                                    if (i === 0) setTrimStart(bounded);
                                                                    if (videoRef.current) videoRef.current.currentTime = bounded;
                                                                }}
                                                                className={`absolute w-full opacity-0 cursor-pointer h-full pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto ${activeHandle === `seg-${i}-start` ? 'z-40' : 'z-20'}`}
                                                            />,
                                                            <input
                                                                key={`in-e-${i}`}
                                                                type="range"
                                                                min={viewStart}
                                                                max={viewEnd}
                                                                step={0.1}
                                                                value={seg.end}
                                                                onMouseDown={() => setActiveHandle(`seg-${i}-end`)}
                                                                onTouchStart={() => setActiveHandle(`seg-${i}-end`)}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value);
                                                                    const minAllowed = seg.start + 0.5;
                                                                    const maxAllowed = i < videoSegments.length - 1 ? videoSegments[i+1].start - 0.5 : videoDuration || 100;
                                                                    const bounded = Math.max(minAllowed, Math.min(val, maxAllowed));
                                                                    
                                                                    setVideoSegments(segs => {
                                                                        const newSegs = [...segs];
                                                                        newSegs[i].end = bounded;
                                                                        return newSegs;
                                                                    });
                                                                    if (i === videoSegments.length - 1) setTrimEnd(bounded);
                                                                    if (videoRef.current) videoRef.current.currentTime = bounded;
                                                                }}
                                                                className={`absolute w-full opacity-0 cursor-pointer h-full pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto ${activeHandle === `seg-${i}-end` ? 'z-40' : 'z-20'}`}
                                                            />
                                                        ])
                                                    ) : (
                                                        <>
                                                            <input
                                                                type="range"
                                                                min={0}
                                                                max={videoDuration || 100}
                                                                step={0.1}
                                                                value={trimStart}
                                                                onMouseDown={() => setActiveHandle('start')}
                                                                onTouchStart={() => setActiveHandle('start')}
                                                                onChange={(e) => onTrimStartChange(Number(e.target.value))}
                                                                className={`absolute w-full opacity-0 cursor-pointer h-full pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto ${activeHandle === 'start' ? 'z-40' : 'z-20'}`}
                                                            />
                                                            <input
                                                                type="range"
                                                                min={0}
                                                                max={videoDuration || 100}
                                                                step={0.1}
                                                                value={trimEnd}
                                                                onMouseDown={() => setActiveHandle('end')}
                                                                onTouchStart={() => setActiveHandle('end')}
                                                                onChange={(e) => onTrimEndChange(Number(e.target.value))}
                                                                className={`absolute w-full opacity-0 cursor-pointer h-full pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto ${activeHandle === 'end' ? 'z-40' : 'z-20'}`}
                                                            />
                                                        </>
                                                    )}
                                                    <input
                                                        type="range"
                                                        min={viewStart}
                                                        max={viewEnd}
                                                        step={0.1}
                                                        value={currentTime}
                                                        onMouseDown={() => setActiveHandle('playhead')}
                                                        onTouchStart={() => setActiveHandle('playhead')}
                                                        onChange={(e) => {
                                                            const val = Number(e.target.value);
                                                            setCurrentTime(val);
                                                            if (videoRef.current) videoRef.current.currentTime = val;
                                                        }}
                                                        className="absolute w-full opacity-0 cursor-pointer h-full pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto z-[60]"
                                                    />

                                                    {/* Visual Progress Layer (Zoomed) */}
                                                    {videoSegments.length > 0 ? (
                                                        videoSegments.map((seg, i) => (
                                                            <div
                                                                key={`prog-${i}`}
                                                                className="absolute h-[2px] bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] transition-all duration-75 pointer-events-auto group/seg"
                                                                style={{
                                                                    left: `${((seg.start - viewStart) / viewRange) * 100}%`,
                                                                    width: `${((seg.end - seg.start) / viewRange) * 100}%`
                                                                }}
                                                            >
                                                                <div className="absolute inset-x-0 -top-4 -bottom-4" title="Segment Block" />
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setVideoSegments(prev => {
                                                                            const next = [...prev];
                                                                            next.splice(i, 1);
                                                                            if (next.length > 0) {
                                                                                setTrimStart(next[0].start);
                                                                                setTrimEnd(next[next.length-1].end);
                                                                            } else {
                                                                                setTrimStart(0);
                                                                                setTrimEnd(videoDuration || 60);
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white opacity-0 group-hover/seg:opacity-100 hover:scale-110 active:scale-95 transition-all shadow-xl z-[70] border border-red-400 cursor-pointer"
                                                                    title="Remove Segment"
                                                                >
                                                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                </button>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div
                                                            className="absolute h-[2px] bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] transition-all duration-75 pointer-events-none"
                                                            style={{
                                                                left: `${((trimStart - viewStart) / viewRange) * 100}%`,
                                                                width: `${((trimEnd - trimStart) / viewRange) * 100}%`
                                                            }}
                                                        />
                                                    )}

                                                    {/* Playhead Indicator (Green - Zoomed) */}
                                                    <div
                                                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-10 bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,1)] pointer-events-none z-50 rounded-full transition-all duration-75 ease-linear border border-white/20"
                                                        style={{ left: `${((currentTime - viewStart) / viewRange) * 100}%` }}
                                                    />

                                                    {/* Handle Layer (Zoomed) */}
                                                    {videoSegments.length > 0 ? (
                                                        videoSegments.flatMap((seg, i) => [
                                                            <div key={`h-s-${i}`} className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full border-2 border-amber-500 shadow-xl pointer-events-none transition-transform duration-200 ${activeHandle === `seg-${i}-start` ? 'scale-125 z-40' : 'z-20'}`}
                                                                style={{ left: `${((seg.start - viewStart) / viewRange) * 100}%` }} />,
                                                            <div key={`h-e-${i}`} className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full border-2 border-amber-500 shadow-xl pointer-events-none transition-transform duration-200 ${activeHandle === `seg-${i}-end` ? 'scale-125 z-40' : 'z-20'}`}
                                                                style={{ left: `${((seg.end - viewStart) / viewRange) * 100}%` }} />
                                                        ])
                                                    ) : (
                                                        <>
                                                            <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full border-2 border-amber-500 shadow-xl pointer-events-none transition-transform duration-200 ${activeHandle === 'start' ? 'scale-125 z-40' : 'z-20'}`}
                                                                style={{ left: `${((trimStart - viewStart) / viewRange) * 100}%` }} />
                                                            <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full border-2 border-amber-500 shadow-xl pointer-events-none transition-transform duration-200 ${activeHandle === 'end' ? 'scale-125 z-40' : 'z-20'}`}
                                                                style={{ left: `${((trimEnd - viewStart) / viewRange) * 100}%` }} />
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    <div className="flex items-center justify-between pointer-events-auto">
                                        <div className="flex gap-8">
                                            <div className="flex flex-col">
                                                <span className="text-[9px] uppercase tracking-widest text-neutral-600 font-black">In Point</span>
                                                <span className="text-xs font-mono text-white">{formatSeconds(trimStart).split(',')[0]}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[9px] uppercase tracking-widest text-neutral-600 font-black">Out Point</span>
                                                <span className="text-xs font-mono text-white">{formatSeconds(trimEnd).split(',')[0]}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[9px] uppercase tracking-widest text-emerald-600 font-black">Current</span>
                                                <span className="text-xs font-mono text-emerald-400 font-bold">{formatSeconds(currentTime).split(',')[0]}</span>
                                            </div>
                                            <div className="flex flex-col px-4 border-l border-white/10">
                                                <span className="text-[9px] uppercase tracking-widest text-neutral-600 font-black">Duration</span>
                                                <span className="text-xs font-mono text-amber-500 font-bold">{(trimEnd - trimStart).toFixed(2)}s</span>
                                            </div>
                                        </div>

                                        <div className="flex gap-4">
                                            <button
                                                onClick={handleResetTrim}
                                                className="px-4 py-2.5 text-[10px] uppercase tracking-widest font-black text-amber-500/50 hover:text-amber-500 flex items-center gap-2 transition-all group"
                                                title="Reset to Full Duration"
                                            >
                                                <svg className="w-3 h-3 group-hover:rotate-[-180deg] transition-transform duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                                Reset
                                            </button>
                                            <button
                                                onClick={() => setIsEditorActive(false)}
                                                className="px-6 py-2.5 text-[10px] uppercase tracking-widest font-black text-neutral-500 hover:text-white transition-all"
                                            >
                                                Discard
                                            </button>
                                            <button
                                                onClick={handleApplyTrim}
                                                className="px-10 py-2.5 bg-amber-500 text-black text-[10px] uppercase tracking-widest font-black rounded-lg hover:scale-105 active:scale-95 transition-all shadow-lg shadow-amber-500/20"
                                            >
                                                {isTrimming ? 'Processing...' : 'Finalize'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : isFinalPreview ? (
                            <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-neutral-950 overflow-y-auto custom-scrollbar">
                                <div className="max-w-4xl w-full flex flex-col gap-10 py-12">
                                    <div className="flex items-center justify-between border-b border-white/5 pb-10">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,1)] animate-pulse" />
                                                <h2 className="text-4xl font-black text-white italic tracking-tighter">Final Production</h2>
                                            </div>
                                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-[0.3em]">Mastering & Synthesis Complete</p>
                                        </div>
                                        <div className="flex gap-4">
                                            <button 
                                                onClick={() => {
                                                    setIsFinalPreview(false);
                                                    setIsEditorActive(true);
                                                    onEditorToggle?.(true);
                                                }}
                                                className="px-6 py-3 bg-neutral-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-all border border-white/10 flex items-center gap-2 group"
                                            >
                                                <svg className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 8.959 8.959 0 01-9 9 9 9 0 01-9-9z"/></svg>
                                                Modify Clip
                                            </button>
                                            <a 
                                                href={clipUrl || '#'} 
                                                download={`production_${Date.now()}.mp4`}
                                                className="px-8 py-3 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-white/20 flex items-center gap-3 group"
                                            >
                                                <svg className="w-4 h-4 transition-transform group-hover:translate-y-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                                                Export Production
                                            </a>
                                        </div>
                                    </div>

                                    <div className="aspect-video bg-black rounded-[2.5rem] overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.8)] border border-white/10 relative group ring-1 ring-white/5">
                                        {clipUrl ? (
                                            <div className="w-full h-full relative cursor-pointer" onClick={handlePlayPause}>
                                                <video
                                                    ref={videoRef}
                                                    src={clipUrl}
                                                    className="w-full h-full object-contain"
                                                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                                                    onPlay={() => setIsPlaying(true)}
                                                    onPause={() => setIsPlaying(false)}
                                                    autoPlay
                                                    loop
                                                />
                                                
                                                {/* Dynamic Captions Overlay (Reused) */}
                                                {showCaptions && (
                                                    <div className={`absolute inset-0 flex items-center justify-center pointer-events-none px-12 z-20 ${
                                                        captionStyles.position === 'top' ? 'items-start pt-20' : 
                                                        captionStyles.position === 'center' ? 'items-center' : 
                                                        captionStyles.position === 'bottom-flush' ? 'items-end pb-8' :
                                                        'items-end pb-24'
                                                    }`}>
                                                        {voiceoverBlocks
                                                            .filter(b => b.text.trim())
                                                            .map(block => {
                                                                const activeVideoTime = isPlaying ? preciseTime : currentTime;
                                                                const clipTime = activeVideoTime;
                                                                const offsetInBlock = clipTime - block.startTime;
                                                                const words = block.text.split(' ');
                                                                
                                                                if (clipTime >= block.startTime && clipTime <= (block.startTime + (block.duration || 4))) {
                                                                    return (
                                                                        <div key={block.id} className={`text-center animate-in zoom-in-95 fade-in duration-300 ${
                                                                            captionStyles.width === 'full' ? 'w-full' : captionStyles.width === 'wide' ? 'max-w-4xl' : 'max-w-2xl'
                                                                        } ${
                                                                            captionStyles.position === 'top' ? 'slide-in-from-top-2' : 
                                                                            captionStyles.position === 'bottom' ? 'slide-in-from-bottom-2' : ''
                                                                        }`}>
                                                                            <div className={`rounded-2xl transition-all shadow-2xl ${
                                                                                captionStyles.padding === 'compact' ? 'px-6 py-2' : 
                                                                                captionStyles.padding === 'relaxed' ? 'px-12 py-8' : 'px-8 py-4'
                                                                            } ${
                                                                                captionStyles.theme === 'glass' ? 'bg-black/70 backdrop-blur-3xl border border-white/10' : 
                                                                                captionStyles.theme === 'solid' ? 'bg-black border border-white/20' : 
                                                                                captionStyles.theme === 'minimal' ? 'bg-black/40 border border-white/5' :
                                                                                'bg-transparent shadow-none border-none'
                                                                            }`}>
                                                                                <p className={`font-black text-white leading-tight tracking-tight drop-shadow-lg transition-all ${
                                                                                    captionStyles.size === 'xs' ? 'text-[11px] sm:text-xs tracking-widest uppercase' :
                                                                                    captionStyles.size === 'small' ? 'text-lg' : 
                                                                                    captionStyles.size === 'large' ? 'text-3xl' : 
                                                                                    'text-xl sm:text-2xl'
                                                                                }`}>
                                                                                    {captionStyles.highlight ? (
                                                                                        (() => {
                                                                                            const activeRefColor = captionStyles.color === 'amber' ? 'text-amber-500' : captionStyles.color === 'rose' ? 'text-rose-500' : captionStyles.color === 'cyan' ? 'text-cyan-400' : 'text-white underline';
                                                                                            const activeGlow = captionStyles.color === 'amber' ? 'rgba(245,158,11,0.5)' : captionStyles.color === 'rose' ? 'rgba(244,63,94,0.5)' : captionStyles.color === 'cyan' ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.5)';
                                                                                            const activeVideoTime = isPlaying ? preciseTime : currentTime;
                                                                                            const clipTime = activeVideoTime;
                                                                                            const offsetInBlock = clipTime - block.startTime;
                                                                                            const words = block.text.split(' ');
                                                                                            
                                                                                            if (block.alignment && block.alignment.characters) {
                                                                                                const starts = block.alignment.character_start_times_seconds;
                                                                                                let activeCharIdx = -1;
                                                                                                for (let i = 0; i < starts.length; i++) {
                                                                                                    if (offsetInBlock >= starts[i]) activeCharIdx = i; else break;
                                                                                                }
                                                                                                let charTraversed = 0;
                                                                                                let activeWordIdx = -1;
                                                                                                words.forEach((word: string, wIdx: number) => {
                                                                                                    const wordRangeStart = charTraversed;
                                                                                                    const wordRangeEnd = charTraversed + word.length;
                                                                                                    if (activeCharIdx >= wordRangeStart && activeCharIdx < wordRangeEnd) activeWordIdx = wIdx;
                                                                                                    charTraversed += word.length + 1;
                                                                                                });
                                                                                                return words.map((word: string, i: number) => (
                                                                                                    <span key={i} className={`transition-all duration-300 ${i === activeWordIdx ? `${activeRefColor} scale-110 drop-shadow-[0_0_10px_${activeGlow}]` : 'opacity-30'}`}>
                                                                                                        {word}{' '}
                                                                                                    </span>
                                                                                                ));
                                                                                            }
                                                                                            const timePerWord = (block.duration || 4) / words.length;
                                                                                            const activeIndex = Math.floor(offsetInBlock / timePerWord);
                                                                                            return words.map((word: string, i: number) => (
                                                                                                <span key={i} className={`transition-all duration-300 ${i === activeIndex ? activeRefColor : 'opacity-30'}`}>
                                                                                                    {word}{' '}
                                                                                                </span>
                                                                                            ));
                                                                                        })()
                                                                                    ) : block.text}
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                }
                                                                return null;
                                                            })}
                                                    </div>
                                                )}

                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30">
                                                    <div className="w-20 h-20 bg-white/10 backdrop-blur-3xl rounded-full flex items-center justify-center border border-white/20 shadow-2xl">
                                                        {isPlaying ? (
                                                            <svg className="w-8 h-8 text-white fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                                                        ) : (
                                                            <svg className="w-8 h-8 text-white fill-current translate-x-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-neutral-500">
                                                <div className="w-12 h-12 border-4 border-white/10 border-t-amber-500 rounded-full animate-spin" />
                                                <p className="text-[10px] font-black uppercase tracking-widest">Mastering Production</p>
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="grid grid-cols-3 gap-6">
                                        <div className="p-6 bg-white/[0.03] border border-white/5 rounded-3xl">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-neutral-600 block mb-2">Vocal Clarity</span>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full w-[95%] bg-emerald-500" />
                                                </div>
                                                <span className="text-[10px] font-mono text-emerald-500">95%</span>
                                            </div>
                                        </div>
                                        <div className="p-6 bg-white/[0.03] border border-white/5 rounded-3xl">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-neutral-600 block mb-2">Visual Fidelity</span>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full w-[100%] bg-amber-500" />
                                                </div>
                                                <span className="text-[10px] font-mono text-amber-500">4K</span>
                                            </div>
                                        </div>
                                        <div className="p-6 bg-white/[0.03] border border-white/5 rounded-3xl">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-neutral-600 block mb-2">Temporal Alignment</span>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full w-[98%] bg-rose-500" />
                                                </div>
                                                <span className="text-[10px] font-mono text-rose-500">98%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="w-full h-full relative group/video">
                                <video
                                    ref={videoRef}
                                    key={showFullVideo ? (fullVideoUrl || 'full') : (clipUrl || 'clip')}
                                    src={showFullVideo ? (fullVideoUrl || (!isYoutube ? activeVideoUrl : undefined)) : (clipUrl || undefined)}
                                    controls={!showFullVideo} // Only native controls for clips
                                    autoPlay
                                    onPlay={() => setIsPlaying(true)}
                                    onPause={() => setIsPlaying(false)}
                                    onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
                                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                                    className="w-full h-full object-contain shadow-2xl"
                                    onClick={handlePlayPause}
                                />
                                
                                {/* Persistent Post-Production Voice Layer (Below Video) */}
                                {voiceoverBlocks.length > 0 && (
                                    <div className="w-full h-2 bg-black border-t border-white/5 relative overflow-hidden flex-shrink-0 group/mini-voice">
                                        <div className="absolute inset-x-0 bottom-0 top-0 bg-amber-500/[0.03]" />
                                        <div className="absolute inset-0 px-0">
                                            {voiceoverBlocks.map(block => (
                                                <div 
                                                    key={block.id}
                                                    className={`absolute top-0 bottom-0 w-2.5 bg-amber-500 rounded-sm shadow-[0_0_5px_rgba(245,158,11,1)] transition-all ${block.filename ? 'opacity-100' : 'opacity-30 ripple-pulse'}`}
                                                    style={{ left: `${(block.startTime / (trimEnd - trimStart || 1)) * 100}%` }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {showFullVideo && (
                                    <>
                                        {/* Large Center Play/Pause Overlay on Hover/Pause */}
                                        {(!isPlaying || !showFullVideo) && (
                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                <div className="w-20 h-20 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full flex items-center justify-center shadow-2xl animate-fade-in">
                                                    <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                </div>
                                            </div>
                                        )}

                                        {/* Custom Premium Controls Bar */}
                                        <div className="absolute bottom-0 left-0 right-0 p-8 pt-20 bg-gradient-to-t from-black via-black/40 to-transparent opacity-0 group-hover/video:opacity-100 transition-all duration-500 transform translate-y-4 group-hover/video:translate-y-0">
                                            <div className="max-w-4xl mx-auto flex flex-col gap-6">
                                                {/* Progressive Seeker */}
                                                <div className="relative h-1.5 group/seeker cursor-pointer">
                                                    <div className="absolute inset-0 bg-white/10 rounded-full" />
                                                    <div
                                                        className="absolute inset-y-0 left-0 bg-rose-500 rounded-full shadow-[0_0_15px_rgba(244,63,94,0.5)]"
                                                        style={{ width: `${(currentTime / (videoDuration || 1)) * 100}%` }}
                                                    />
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={videoDuration || 100}
                                                        step={0.1}
                                                        value={currentTime}
                                                        onChange={(e) => {
                                                            const val = Number(e.target.value);
                                                            setCurrentTime(val);
                                                            if (videoRef.current) videoRef.current.currentTime = val;
                                                        }}
                                                        className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
                                                    />
                                                    {/* Hover Glow Dot */}
                                                    <div
                                                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full border-2 border-rose-500 shadow-xl opacity-0 group-hover/seeker:opacity-100 transition-opacity pointer-events-none"
                                                        style={{ left: `${(currentTime / (videoDuration || 1)) * 100}%`, marginLeft: '-8px' }}
                                                    />
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-8">
                                                        {/* Play/Pause Button */}
                                                        <button
                                                            onClick={handlePlayPause}
                                                            className="text-white hover:scale-110 active:scale-95 transition-all outline-none"
                                                        >
                                                            {isPlaying ? (
                                                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                                                            ) : (
                                                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                            )}
                                                        </button>

                                                        {/* Time Display */}
                                                        <div className="flex items-center gap-2 font-mono text-[11px] font-black tracking-widest text-neutral-400">
                                                            <span className="text-white">{formatSeconds(currentTime).split(',')[0]}</span>
                                                            <span className="text-neutral-700">/</span>
                                                            <span>{formatSeconds(videoDuration).split(',')[0]}</span>
                                                        </div>

                                                        {/* Sound Controls */}
                                                        <div className="flex items-center gap-4 group/volume bg-white/[0.03] px-4 py-2 rounded-xl border border-white/5 hover:bg-white/[0.06] transition-all">
                                                            <button onClick={toggleMute} className="text-neutral-400 hover:text-white transition-colors">
                                                                {isMuted || volume === 0 ? (
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1V10a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                                                                ) : (
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M12 18.689L7.213 15.01A1 1 0 017 14.13V9.87a1 1 0 01.213-.881L12 5.311V18.69z" /></svg>
                                                                )}
                                                            </button>
                                                            <input
                                                                type="range"
                                                                min={0}
                                                                max={1}
                                                                step={0.01}
                                                                value={isMuted ? 0 : volume}
                                                                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                                                                className="w-0 group-hover/volume:w-20 overflow-hidden transition-all duration-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white"
                                                            />
                                                        </div>
                                                    </div>

                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            {/* MAGIC SCRIPT MODAL */}
            {isMagicModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-24 bg-black/60 backdrop-blur-3xl animate-in fade-in duration-500">
                    <div className="w-full max-w-xl bg-neutral-900/40 border border-white/10 rounded-[2.5rem] p-10 shadow-2xl relative overflow-hidden group">
                        {/* Background Energy Glow */}
                        <div className="absolute -top-24 -right-24 w-60 h-60 bg-amber-500/20 rounded-full blur-[80px] group-hover:bg-amber-500/30 transition-all duration-700" />
                        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-rose-500/10 rounded-full blur-[80px] group-hover:bg-rose-500/20 transition-all duration-700" />

                        {!isMagicLoading ? (
                            <div className="relative z-10 flex flex-col gap-8">
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
                                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/></svg>
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-white tracking-tight">Magic Script Engine</h2>
                                            <p className="text-[10px] text-neutral-500 uppercase tracking-[0.2em] font-bold">Multimodal Narrator Architecture</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-4">
                                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-neutral-400">Describe the Narration Style</label>
                                    <textarea
                                        value={magicPrompt}
                                        onChange={(e) => setMagicPrompt(e.target.value)}
                                        placeholder="E.g., 'A dramatic documentary style focusing on the city lights' or 'Informative and upbeat tech review'..."
                                        className="w-full h-32 bg-black/40 border border-white/5 rounded-2xl p-6 text-sm text-white placeholder:text-neutral-700 outline-none focus:border-amber-500/30 transition-all resize-none shadow-inner"
                                    />
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => setIsMagicModalOpen(false)}
                                        className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-neutral-400 hover:bg-white/10 hover:text-white transition-all shadow-xl"
                                    >
                                        Abort Mission
                                    </button>
                                            <button
                                                onClick={async () => {
                                                    if (!magicPrompt.trim()) return;
                                                    setIsMagicLoading(true);
                                                    setMagicProgress(0);
                                                    setMagicStatus("Initializing Neural Link");
                                                    try {
                                                        const response = await fetch('/api/magic-script', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                videoUrl: activeVideoUrl,
                                                                trimStart,
                                                                trimEnd,
                                                                prompt: magicPrompt
                                                            })
                                                        });

                                                        const reader = response.body?.getReader();
                                                        const decoder = new TextDecoder();

                                                        while (reader) {
                                                            const { value, done } = await reader.read();
                                                            if (done) break;

                                                            const chunk = decoder.decode(value);
                                                            const lines = chunk.split('\n');

                                                            for (const line of lines) {
                                                                if (line.startsWith('data: ')) {
                                                                    try {
                                                                        const data = JSON.parse(line.slice(6));
                                                                        if (data.step) setMagicStatus(data.step);
                                                                        if (data.progress) setMagicProgress(data.progress);
                                                                        if (data.blocks) {
                                                                            const newBlocks = data.blocks.map((b: any) => ({
                                                                                ...b,
                                                                                id: `v_${Math.random().toString(36).substr(2, 9)}`,
                                                                            }));
                                                                            setVoiceoverBlocks(prev => [...prev, ...newBlocks]);
                                                                            setIsMagicModalOpen(false);
                                                                            setMagicPrompt("");
                                                                        }
                                                                        if (data.error) throw new Error(data.error);
                                                                    } catch (e) {
                                                                        console.error("Parse error:", e);
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    } catch (err) {
                                                        console.error('Magic script generation failed:', err);
                                                    } finally {
                                                        setIsMagicLoading(false);
                                                    }
                                                }}
                                                disabled={!magicPrompt.trim()}
                                                className="flex-[2] py-4 bg-amber-500 text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-2xl shadow-amber-500/20 disabled:opacity-30 disabled:grayscale disabled:hover:scale-100"
                                            >
                                                Execute Synthesis
                                            </button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative z-10 py-10 flex flex-col items-center justify-center text-center gap-8 animate-in fade-in duration-500">
                                <div className="relative">
                                    <div className="w-24 h-24 border-[3px] border-amber-500/10 border-t-amber-500 rounded-full animate-[spin_1.5s_linear_infinite]" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <svg className="w-8 h-8 text-amber-500 animate-pulse" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/></svg>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-3">
                                    <h3 className="text-xl font-black text-white italic tracking-tight">{magicStatus}</h3>
                                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-neutral-500">
                                        <span className={magicProgress < 30 ? 'animate-pulse text-amber-500' : 'text-neutral-700'}>Extraction</span>
                                        <span className="w-1 h-1 rounded-full bg-neutral-800" />
                                        <span className={magicProgress >= 30 && magicProgress < 60 ? 'animate-pulse text-amber-500' : 'text-neutral-700'}>Transcription</span>
                                        <span className="w-1 h-1 rounded-full bg-neutral-800" />
                                        <span className={magicProgress >= 60 && magicProgress < 90 ? 'animate-pulse text-amber-500' : 'text-neutral-700'}>Analysis</span>
                                        <span className="w-1 h-1 rounded-full bg-neutral-800" />
                                        <span className={magicProgress >= 90 ? 'animate-pulse text-amber-500' : 'text-neutral-700'}>Synthesis</span>
                                    </div>
                                </div>
                                <div className="w-full max-w-xs h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                    <div 
                                        className="h-full bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500 transition-all duration-700 ease-out shadow-[0_0_15px_rgba(245,158,11,0.3)]" 
                                        style={{ width: `${magicProgress}%` }}
                                    />
                                </div>
                                <p className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest max-w-[200px] leading-relaxed">
                                    Our AI is currently examining every frame and phoneme to craft the perfect narration.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* VOICE SELECTOR MODAL */}
            {isVoiceModalOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 sm:p-24 bg-black/80 backdrop-blur-3xl animate-in fade-in duration-500">
                    <div className="w-full max-w-4xl bg-neutral-900/60 border border-white/10 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden flex flex-col gap-10">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-2xl font-black text-white tracking-tight">Vocal Library</h2>
                                <p className="text-[10px] text-neutral-500 uppercase tracking-[0.2em] font-bold">ElevenLabs Intelligence Catalog</p>
                            </div>
                            <button onClick={() => setIsVoiceModalOpen(false)} className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-neutral-500 hover:text-white transition-all hover:rotate-90">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6 overflow-y-auto max-h-[60vh] pr-4 custom-scrollbar">
                            {voices.map(voice => (
                                <div 
                                    key={voice.id}
                                    onClick={() => {
                                        if (activeSelectionBlockId) {
                                            setVoiceoverBlocks(prev => prev.map(b => b.id === activeSelectionBlockId ? { ...b, voiceId: voice.id, audioUrl: undefined } : b));
                                        } else {
                                            setDefaultVoiceId(voice.id);
                                        }
                                        setIsVoiceModalOpen(false);
                                    }}
                                    className={`group cursor-pointer p-6 rounded-3xl border transition-all relative ${
                                        (activeSelectionBlockId ? voiceoverBlocks.find(b => b.id === activeSelectionBlockId)?.voiceId === voice.id : defaultVoiceId === voice.id)
                                        ? 'bg-purple-500/20 border-purple-500 shadow-2xl shadow-purple-500/20' 
                                        : 'bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/[0.08]'
                                    }`}
                                >
                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-center justify-between">
                                            <div className="w-8 h-8 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-500">
                                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                                            </div>
                                            {voice.previewUrl && (
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        
                                                        // Stop previous
                                                        if (previewAudioRef.current) {
                                                            previewAudioRef.current.pause();
                                                            if (playingVoiceId === voice.id) {
                                                                setPlayingVoiceId(null);
                                                                return;
                                                            }
                                                        }

                                                        const audio = new Audio(voice.previewUrl);
                                                        previewAudioRef.current = audio;
                                                        setPlayingVoiceId(voice.id);
                                                        
                                                        audio.play().catch(e => console.warn('Preview blocked:', e));
                                                        audio.onended = () => setPlayingVoiceId(null);
                                                    }}
                                                    className={`w-8 h-8 rounded-xl transition-all flex items-center justify-center ${playingVoiceId === voice.id ? 'bg-purple-500 text-white' : 'bg-white/5 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-white'}`}
                                                >
                                                    {playingVoiceId === voice.id ? (
                                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                                                    ) : (
                                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-black text-white">{voice.name}</h3>
                                            <p className="text-[9px] text-neutral-500 uppercase tracking-widest font-bold mt-1">{voice.category}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function SyncAudioPreview({ isPlaying, currentTime, trimStart, blocks }: any) {
    const playedBlocks = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!isPlaying) {
            playedBlocks.current.clear();
            return;
        }

        const clipTime = currentTime - trimStart;
        blocks.forEach((block: any) => {
            if (block.audioUrl && !playedBlocks.current.has(block.id)) {
                // Check if current clip time is past the start point by a small margin
                if (clipTime >= block.startTime && clipTime <= block.startTime + 0.3) {
                    const audio = new Audio(block.audioUrl);
                    audio.play().catch(e => console.warn('Audio play blocked:', e));
                    playedBlocks.current.add(block.id);
                }
            }
            // If we've moved back before the block, let it play again next time
            if (clipTime < block.startTime - 0.5) {
                playedBlocks.current.delete(block.id);
            }
        });
    }, [currentTime, isPlaying, trimStart, blocks]);

    return null;
}
