'use client';

interface ContextDebugModalProps {
    isOpen: boolean;
    content: string;
    onClose: () => void;
}

export default function ContextDebugModal({ isOpen, content, onClose }: ContextDebugModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 animate-fade-in group">
            <div 
                className="absolute inset-0 bg-black/60 backdrop-blur-xl transition-opacity group-hover:bg-black/70" 
                onClick={onClose} 
            />
            
            <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col glass-card rounded-[2rem] bg-[#0a0a0a]/90 border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.9)] overflow-hidden scale-in">
                {/* Header */}
                <div className="flex items-center justify-between p-8 border-b border-white/5 bg-white/[0.02]">
                    <div>
                        <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                            Retrieval Context Inspector
                        </h2>
                        <p className="text-[10px] text-neutral-500 uppercase tracking-[0.2em] font-bold mt-1">
                            Raw Data Ground Truth provided to the LLM
                        </p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-3 rounded-xl bg-white/5 hover:bg-white text-neutral-400 hover:text-black transition-all active:scale-90"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-8 space-y-6">
                    <div className="grid grid-cols-1 gap-6">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="px-2 py-1 rounded-md bg-rose-500/10 text-rose-400 text-[9px] font-black uppercase tracking-widest border border-rose-500/20">
                                    Raw Semantic Context Payload (JSON)
                                </span>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(content);
                                        alert('JSON copied to clipboard');
                                    }}
                                    className="text-[9px] font-bold text-neutral-500 hover:text-white uppercase tracking-widest transition-colors flex items-center gap-2"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                    Copy JSON
                                </button>
                            </div>
                            <div className="p-8 rounded-2xl bg-black border border-white/5 font-mono text-xs leading-relaxed text-neutral-300 whitespace-pre overflow-x-auto selection:bg-rose-500 selection:text-white">
                                {content}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 bg-white/[0.02] border-t border-white/5 flex justify-end">
                    <button 
                        onClick={onClose}
                        className="px-8 py-3 bg-white text-black font-black rounded-xl hover:bg-neutral-200 transition-all text-[10px] uppercase tracking-widest shadow-xl active:scale-95"
                    >
                        Close Inspector
                    </button>
                </div>
            </div>
        </div>
    );
}
