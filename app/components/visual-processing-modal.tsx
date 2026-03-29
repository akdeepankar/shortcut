'use client';

import { useState, useEffect } from 'react';

interface VisualStatus {
    stage: 'downloading' | 'extracting' | 'analyzing' | 'indexing' | 'complete' | 'error';
    message: string;
    progress: number;
    error?: string;
    complete: boolean;
}

interface VisualProcessingModalProps {
    isOpen: boolean;
    processingId: string;
    onClose: () => void;
    onComplete: () => void;
}

export default function VisualProcessingModal({ isOpen, processingId, onClose, onComplete }: VisualProcessingModalProps) {
    const [status, setStatus] = useState<VisualStatus>({
        stage: 'downloading',
        message: 'Initializing vision engine...',
        progress: 0,
        complete: false
    });

    useEffect(() => {
        if (isOpen && processingId) {
            pollStatus(processingId);
        }
    }, [isOpen, processingId]);

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
                            onComplete();
                            onClose();
                        }, 2000);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch status:', error);
            }
        }, 1500);

        return () => clearInterval(interval);
    };

    if (!isOpen) return null;

    const stages = [
        { key: 'downloading', label: 'Capture' },
        { key: 'extracting', label: 'Frame' },
        { key: 'analyzing', label: 'GPT Vision' },
        { key: 'indexing', label: 'Index' }
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-fade-in overflow-hidden">
            <div className="absolute inset-0 bg-[#020202]/90 backdrop-blur-3xl" />

            {/* Animated Scanning Line Decoration */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-20">
                <div className="w-full h-[2px] bg-rose-500 shadow-[0_0_20px_rgba(244,63,94,1)] animate-scan-y" />
            </div>

            <div className="relative w-full max-w-2xl glass-card rounded-3xl bg-neutral-900/40 border border-white/5 shadow-[0_0_100px_rgba(244,63,94,0.1)] overflow-hidden">
                <div className="p-12">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-12">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-rose-500 flex items-center justify-center shadow-[0_0_30px_rgba(244,63,94,0.3)]">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Visual Intelligence</h2>
                                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest bg-rose-500/10 px-2 py-0.5 rounded inline-block mt-1">
                                    Deep Multimodal Analysis
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-4xl font-black text-rose-500 tabular-nums leading-none mb-1">{status.progress}%</div>
                            <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">Processing Data</div>
                        </div>
                    </div>

                    {status.stage === 'error' ? (
                        <div className="animate-in fade-in slide-in-from-bottom-4">
                            <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-mono mb-8 leading-relaxed">
                                <div className="font-bold mb-2 uppercase tracking-widest">Critical Vision Error:</div>
                                {status.error}
                            </div>
                            <button
                                onClick={onClose}
                                className="w-full py-5 bg-white text-black font-black rounded-2xl hover:bg-neutral-200 transition-all text-xs uppercase tracking-[0.2em] shadow-2xl"
                            >
                                Re-initialize Intelligence
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-12">
                            {/* Main Progress Bar */}
                            <div className="relative">
                                <div className="h-2 w-full bg-white/[0.03] rounded-full overflow-hidden border border-white/5">
                                    <div
                                        className="h-full bg-gradient-to-r from-rose-500 to-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.5)] transition-all duration-1000 ease-out flex items-center justify-end pr-2 overflow-hidden"
                                        style={{ width: `${status.progress}%` }}
                                    >
                                        <div className="w-full h-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                                    </div>
                                </div>
                            </div>

                            {/* Stage Steps */}
                            <div className="grid grid-cols-4 gap-4 relative">
                                {stages.map((stage, i) => {
                                    const isActive = status.stage === stage.key;
                                    const isComplete = stages.findIndex(s => s.key === status.stage) > i || status.complete;

                                    return (
                                        <div key={stage.key} className={`flex flex-col items-center gap-3 transition-all duration-500 ${isActive || isComplete ? 'opacity-100' : 'opacity-20'}`}>
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-500 ${isComplete ? 'bg-rose-500 border-rose-500 scale-90' :
                                                    isActive ? 'bg-white/10 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)] animate-pulse' :
                                                        'bg-white/5 border-white/10'
                                                }`}>
                                                {isComplete ? (
                                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                ) : (
                                                    <span className="text-xs font-black text-rose-500">{i + 1}</span>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <span className={`text-[9px] font-black uppercase tracking-[0.2em] mb-1 ${isComplete ? 'text-rose-500' : isActive ? 'text-white' : 'text-neutral-600'}`}>
                                                    {stage.label}
                                                </span>
                                                {isActive && (
                                                    <div className="animate-pulse text-[8px] text-rose-400/50 font-bold uppercase tracking-tighter">Running</div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Connection Lines */}
                                <div className="absolute top-5 left-10 right-10 h-[2px] bg-white/[0.03] -z-10" />
                            </div>

                            {/* Message Display */}
                            <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl text-center">
                                <p className="text-xs text-neutral-400 font-medium leading-relaxed tracking-wide animate-pulse">
                                    {status.message}
                                </p>
                            </div>

                            {/* Info Footer */}
                            <div className="flex items-center justify-center gap-4 text-[9px] font-bold text-neutral-600 uppercase tracking-widest">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-blink" />
                                    GPT-4o Vision Active
                                </div>
                                <div className="w-1 h-1 bg-neutral-800 rounded-full" />
                                <div>Low-bit Keyframe Extraction</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
