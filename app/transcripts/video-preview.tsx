'use client';

import { useState, useEffect, useRef } from 'react';

interface VideoPreviewProps {
    timestamp: { start: string; end: string; videoUrl?: string } | null;
    defaultVideoUrl?: string;
    onFinalize?: (data: { clipUrl: string; startTime: string; endTime: string; sourceUrl: string }) => void;
    onEditorToggle?: (isActive: boolean) => void;
}

export default function VideoPreview({ timestamp, defaultVideoUrl, onFinalize, onEditorToggle }: VideoPreviewProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [clipUrl, setClipUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showFullVideo, setShowFullVideo] = useState(false);
    const [fullVideoUrl, setFullVideoUrl] = useState<string | null>(null);
    const [isDownloadingFull, setIsDownloadingFull] = useState(false);
    const [isEditorActive, setIsEditorActive] = useState(false);
    const [trimStart, setTrimStart] = useState(0);
    const [trimEnd, setTrimEnd] = useState(60);
    const [videoDuration, setVideoDuration] = useState(0);
    const [isTrimming, setIsTrimming] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const [activeHandle, setActiveHandle] = useState<'start' | 'end' | 'playhead' | null>(null);

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
        setIsEditorActive(false);
        setShowFullVideo(false);
        setFullVideoUrl(null);
        if (!timestamp || !activeVideoUrl) {
            setClipUrl(null);
            setError(null);
            return;
        }

        const loadClip = async () => {
            setIsLoading(true);
            setError(null);
            setClipUrl(null);

            try {
                const response = await fetch('/api/clip-video', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        videoUrl: activeVideoUrl,
                        startTime: timestamp.start,
                        endTime: timestamp.end
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to create clip');
                setClipUrl(data.clipUrl);
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
                    endTime: formatSeconds(trimEnd)
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to trim video');
            setClipUrl(data.clipUrl);
            setIsEditorActive(false);
            onEditorToggle?.(false);
            setShowFullVideo(false);

            // Notify parent about the final cut
            onFinalize?.({
                clipUrl: data.clipUrl,
                startTime: formatSeconds(trimStart),
                endTime: formatSeconds(trimEnd),
                sourceUrl: activeVideoUrl || ''
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
        setIsEditorActive(!isEditorActive);
        onEditorToggle?.(!isEditorActive);
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

    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
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
        if (videoRef.current) {
            videoRef.current.currentTime = newVal;
        }
    };

    const onTrimEndChange = (val: number) => {
        const newVal = Math.max(val, trimStart + 0.5);
        setTrimEnd(newVal);
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
                                        sourceUrl: activeVideoUrl || ''
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
                </div>
            </div>

            {/* Video Viewport */}
            <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
                {!timestamp && !showFullVideo && !isDownloadingFull && !isEditorActive ? (
                    <div className="flex flex-col items-center justify-center px-10 text-center animate-fade-in group">
                        <div className="w-20 h-20 mb-8 flex items-center justify-center glass-card rounded-[2rem] border-white/10 opacity-40 group-hover:opacity-100 group-hover:scale-110 group-hover:rotate-12 transition-all duration-700 bg-gradient-to-br from-white/5 to-transparent">
                            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </div>

                        <h3 className="text-lg font-bold text-white mb-2 tracking-tight">No Active Video</h3>
                        <p className="text-[10px] uppercase tracking-[0.3em] font-black text-rose-500/50 mb-10">Waiting for Ingestion</p>

                        <div className="flex flex-col gap-6 items-center">
                            <div className="flex items-center gap-3 px-6 py-4 bg-white/[0.02] border border-white/5 rounded-2xl backdrop-blur-3xl animate-pulse">
                                <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,1)]" />
                                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">System Ready: Paste a URL above to begin</span>
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
                            <div className="w-full h-full flex flex-col bg-neutral-950 p-6 pt-24">
                                <div className="flex-1 min-h-0 relative rounded-xl border border-white/5 overflow-hidden group bg-black shadow-inner flex items-center justify-center">
                                    <video
                                        ref={videoRef}
                                        src={fullVideoUrl || (!isYoutube ? activeVideoUrl : undefined)}
                                        onLoadedMetadata={(e) => {
                                            const duration = e.currentTarget.duration;
                                            setVideoDuration(duration);
                                            // Only set trim end to duration if not already set by a segment
                                            if (!timestamp) {
                                                setTrimEnd(duration);
                                            } else {
                                                const s = parseTime(timestamp.start);
                                                e.currentTarget.currentTime = s;
                                            }
                                        }}
                                        onPlay={() => setIsPlaying(true)}
                                        onPause={() => setIsPlaying(false)}
                                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                                        className="max-w-full max-h-full object-contain cursor-pointer"
                                        onClick={handlePlayPause}
                                    />

                                    {/* Custom Play/Pause Overlay */}
                                    {!isPlaying && (
                                        <button
                                            onClick={handlePlayPause}
                                            className="absolute w-20 h-20 bg-white/10 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-2xl z-20"
                                        >
                                            <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                        </button>
                                    )}
                                </div>

                                <div className="h-40 flex flex-col justify-center gap-6 mt-4 px-4 overflow-visible">
                                    <div className="relative h-12 bg-white/5 rounded-full border border-white/10 flex items-center px-6 shadow-inner">
                                        <div className="absolute inset-x-6 h-1 bg-white/10 rounded-full" />

                                        {/* Slider Input Layer - Using pointer-events Pass-through trick */}
                                        <div className="absolute inset-x-6 h-full flex items-center pointer-events-none">
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
                                            <input
                                                type="range"
                                                min={0}
                                                max={videoDuration || 100}
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

                                            {/* Visual Progress Layer */}
                                            <div
                                                className="absolute h-[2px] bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] transition-all duration-75 pointer-events-none"
                                                style={{
                                                    left: `${(trimStart / (videoDuration || 100)) * 100}%`,
                                                    width: `${((trimEnd - trimStart) / (videoDuration || 100)) * 100}%`
                                                }}
                                            />

                                            {/* Playhead Indicator (Green) */}
                                            <div
                                                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-10 bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,1)] pointer-events-none z-50 rounded-full transition-all duration-75 ease-linear border border-white/20"
                                                style={{ left: `${(currentTime / (videoDuration || 100)) * 100}%` }}
                                            />

                                            {/* Handle Layer */}
                                            <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full border-2 border-amber-500 shadow-xl pointer-events-none transition-transform duration-200 ${activeHandle === 'start' ? 'scale-125 z-40' : 'z-20'}`}
                                                style={{ left: `${(trimStart / (videoDuration || 100)) * 100}%` }} />
                                            <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full border-2 border-amber-500 shadow-xl pointer-events-none transition-transform duration-200 ${activeHandle === 'end' ? 'scale-125 z-40' : 'z-20'}`}
                                                style={{ left: `${(trimEnd / (videoDuration || 100)) * 100}%` }} />
                                        </div>
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
                                                Apply Professional Cut
                                            </button>
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

                                                    {/* Pro Badge */}
                                                    <div className="flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                                                        <div className="w-1 h-1 rounded-full bg-rose-500 animate-pulse" />
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-rose-500">Live Preview</span>
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

                {/* Floating Download Button */}
                {((showFullVideo && (fullVideoUrl || !isYoutube)) || (!showFullVideo && clipUrl)) && !isLoading && !isDownloadingFull && !isEditorActive && (
                    <button
                        onClick={handleDownload}
                        className="absolute bottom-8 right-8 w-14 h-14 bg-white text-black rounded-xl flex items-center justify-center shadow-[0_10px_40px_rgba(255,255,255,0.3)] hover:scale-110 active:scale-95 transition-all group z-30"
                        title={showFullVideo ? "Download Full Video" : "Download Segment"}
                    >
                        <svg className="w-6 h-6 group-hover:translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}
