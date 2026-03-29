'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface ProcessingStatus {
    stage: 'downloading' | 'transcribing' | 'analyzing' | 'indexing' | 'complete' | 'error';
    message: string;
    progress: number;
    error?: string;
    complete: boolean;
}

interface ProcessingModalProps {
    isOpen: boolean;
    videoUrl: string;
    engine: 'openai' | 'elevenlabs';
    onClose: () => void;
}

export default function ProcessingModal({ isOpen, videoUrl, engine, onClose }: ProcessingModalProps) {
    const router = useRouter();
    const [status, setStatus] = useState<ProcessingStatus>({
        stage: 'downloading',
        message: 'Initializing...',
        progress: 0,
        complete: false
    });
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && videoUrl) {
            const apiKey = localStorage.getItem(engine === 'openai' ? 'openai_api_key' : 'elevenlabs_api_key');
            startProcessing(videoUrl, apiKey || '', engine);
        }
    }, [isOpen, videoUrl, engine]);

    const startProcessing = async (videoUrl: string, apiKey: string, engine: string) => {
        try {
            setStatus({
                stage: 'downloading',
                message: 'Preparing workspace...',
                progress: 5,
                complete: false
            });

            const response = await fetch('/api/process-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoUrl, apiKey, engine })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to start processing');
            }

            const data = await response.json();
            setProcessingId(data.processingId);
            pollStatus(data.processingId);

        } catch (err) {
            setStatus({
                stage: 'error',
                message: 'Processing Interrupted',
                progress: 0,
                error: err instanceof Error ? err.message : 'Unknown error',
                complete: false
            });
        }
    };

    const pollStatus = async (id: string) => {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/api/process-status?id=${id}`);
                if (!response.ok) {
                    clearInterval(interval);
                    return;
                }

                const statusData = await response.json();
                setStatus(statusData);

                if (statusData.complete || statusData.stage === 'error') {
                    clearInterval(interval);
                    if (statusData.complete && statusData.stage === 'complete') {
                        setTimeout(() => {
                            router.push('/transcripts');
                            onClose();
                        }, 1500);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch status:', error);
            }
        }, 1000);

        return () => clearInterval(interval);
    };

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-[#050505]/80 backdrop-blur-2xl" onClick={status.stage === 'error' ? onClose : undefined} />

            <div className="relative w-full max-w-xl glass-card rounded-2xl bg-[#0a0a0a]/80 border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden scale-in">
                {/* Visual Header Decoration */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                <div className="p-10 flex flex-col items-center text-center">
                    {/* Animated Engine Icon */}
                    <div className="w-20 h-20 mb-8 relative">
                        <div className={`absolute inset-0 rounded-2xl bg-white/5 animate-pulse border border-white/10`} />
                        <div className="absolute inset-0 flex items-center justify-center">
                            {engine === 'openai' ? (
                                <svg className="w-10 h-10 text-white animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                                </svg>
                            ) : (
                                <svg className="w-10 h-10 text-white animate-bounce-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                </svg>
                            )}
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold tracking-tight text-white mb-2">
                        {status.stage === 'error' ? 'Something went wrong' : status.complete ? 'Successfully Ingested' : 'Intelligent Processing'}
                    </h2>

                    <p className="text-neutral-500 text-sm font-medium uppercase tracking-[0.2em] mb-10">
                        {status.message}
                    </p>

                    {status.stage === 'error' ? (
                        <div className="w-full">
                            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-mono mb-8 break-all">
                                {status.error}
                            </div>
                            <button
                                onClick={onClose}
                                className="w-full py-4 bg-white text-black font-black rounded-xl hover:bg-neutral-200 transition-all text-xs uppercase tracking-widest"
                            >
                                Dismiss and Retry
                            </button>
                        </div>
                    ) : (
                        <div className="w-full space-y-12">
                            {/* Modern Progress Line */}
                            <div className="relative pt-1">
                                <div className="flex mb-4 items-center justify-between">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-neutral-600">
                                        Real-time Synchronization
                                    </div>
                                    <div className="text-sm font-black text-white tabular-nums">
                                        {status.progress}%
                                    </div>
                                </div>
                                <div className="overflow-hidden h-1 text-xs flex rounded-full bg-white/5">
                                    <div
                                        style={{ width: `${status.progress}%` }}
                                        className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-white transition-all duration-700 ease-out"
                                    />
                                </div>
                            </div>

                            {/* Stage Steps */}
                            <div className="grid grid-cols-4 gap-4">
                                {[
                                    { s: 'downloading', l: 'Source', p: 10 },
                                    { s: 'transcribing', l: 'Speech', p: 30 },
                                    { s: 'analyzing', l: 'Visual', p: 60 },
                                    { s: 'indexing', l: 'Catalog', p: 95 }
                                ].map((step) => (
                                    <div key={step.s} className="flex flex-col items-center gap-2">
                                        <div className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${status.progress >= step.p ? 'bg-white scale-125 shadow-[0_0_10px_white]' : 'bg-neutral-800'}`} />
                                        <span className={`text-[9px] font-bold uppercase tracking-widest ${status.progress >= step.p ? 'text-white' : 'text-neutral-700'}`}>
                                            {step.l}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
