'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SettingsModal from './components/settings-modal';
import ProcessingModal from './components/processing-modal';

export default function Home() {
    const router = useRouter();
    const [url, setUrl] = useState('');
    const [engine, setEngine] = useState<'openai' | 'elevenlabs'>('elevenlabs');
    const [showSettings, setShowSettings] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [userId, setUserId] = useState<string>('global');

    useEffect(() => {
        // Initialize or retrieve unique user ID for multi-user isolation
        let storedId = localStorage.getItem('clipper_user_id');
        if (!storedId) {
            storedId = `user_${Math.random().toString(36).substring(2, 15)}`;
            localStorage.setItem('clipper_user_id', storedId);
        }
        setUserId(storedId);
    }, []);

    const handleGetStarted = (e: React.FormEvent) => {
        e.preventDefault();
        if (!url.trim()) return;

        const youtubeRegex = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})(?:&.*)?$/i;
        if (!youtubeRegex.test(url.trim())) {
            alert('Please enter a valid YouTube URL');
            return;
        }

        setIsProcessing(true);
    };

    return (
        <div className="min-h-screen font-sans selection:bg-white selection:text-black bg-[#050505] text-[#ededed] flex flex-col relative overflow-hidden">

            {/* Background elements - more subtle depth */}
            <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-white/[0.02] rounded-full blur-[140px] pointer-events-none"></div>
            <div className="absolute top-[10%] right-[-10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[160px] pointer-events-none animate-pulse-slow"></div>
            <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[160px] pointer-events-none animate-pulse-slow"></div>

            {/* Background Icon */}
            <div className="absolute -bottom-32 -right-32 opacity-[0.03] pointer-events-none rotate-[-15deg]">
                <img src="https://cdn-icons-png.freepik.com/256/4415/4415274.png?semt=ais_white_label" className="w-[100vw] h-[100vw] max-w-[1000px] max-h-[1000px] filter invert" alt="" />
            </div>

            {/* Navbar */}
            <nav className="absolute top-0 inset-x-0 h-24 flex items-center justify-between px-10 z-50 animate-fade-in">
                <div className="flex items-center gap-2 relative group">
                    <img src="https://cdn-icons-png.freepik.com/256/4415/4415274.png?semt=ais_white_label" className="w-5 h-5 relative z-10 filter invert opacity-80" alt="Shortcut Logo" />
                    <span className="text-xl font-bold tracking-tighter text-slate-300">Shortcut.</span>
                </div>
            </nav>

            {/* Content Container */}
            <div className="flex-1 flex flex-col z-10 max-w-5xl mx-auto w-full px-8 pt-24 mt-12">
                
                {/* Minimal Hero */}

                {/* Minimal Hero */}
                <main className="flex-1 flex flex-col items-center justify-center text-center mt-[-40px]">
                    
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-6 leading-tight animate-fade-in uppercase">
                        Edit at the speed of thought.
                    </h1>

                    <p className="max-w-md text-sm text-neutral-500 mb-12 leading-relaxed font-medium animate-fade-in opacity-80 uppercase tracking-widest">
                        Ingest YouTube videos. Synthesis speech and visuals. Ask anything.
                    </p>

                    {/* Minimal Input Area - Spotlight Style */}
                    <form onSubmit={handleGetStarted} className="w-full max-w-xl animate-fade-in">
                        <div className="relative group">
                            <div className="absolute inset-0 bg-white/[0.03] rounded-2xl blur-xl group-focus-within:bg-white/[0.07] transition-all"></div>
                            
                            <div className="relative flex items-center bg-[#0a0a0a]/80 border border-white/10 rounded-2xl backdrop-blur-3xl transition-all focus-within:border-white/20 overflow-hidden shadow-2xl">
                                <div className="pl-6 text-neutral-500">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </div>

                                <input
                                    type="url"
                                    placeholder="Paste video link..."
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="flex-1 bg-transparent border-none text-white placeholder:text-neutral-700 focus:ring-0 px-4 py-6 text-sm font-medium outline-none"
                                />

                                <div className="flex items-center gap-1.5 px-4 pr-6">
                                    <button
                                        type="button"
                                        onClick={() => setEngine(engine === 'openai' ? 'elevenlabs' : 'openai')}
                                        className="text-[10px] font-black uppercase tracking-widest text-neutral-500 hover:text-white transition-all transition-colors"
                                    >
                                        {engine === 'openai' ? 'Whisper' : 'Scribe'}
                                    </button>
                                    <div className="w-[1px] h-3 bg-white/10 mx-2"></div>
                                    <button
                                        type="submit"
                                        className="text-[10px] font-black uppercase tracking-widest text-white hover:text-rose-500 transition-all"
                                    >
                                        Run
                                    </button>
                                </div>
                            </div>
                        </div>


                    </form>
                </main>

                {/* Ultra Minimal Footer */}
                <footer className="py-12 flex items-center justify-center animate-fade-in opacity-40">
                    <p className="text-[9px] uppercase tracking-[0.3em] text-neutral-500 font-black">
                        ShortCut System &copy; {new Date().getFullYear()}
                    </p>
                </footer>
            </div>


            {/* Settings Modal */}
            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

            {/* Processing Modal */}
            <ProcessingModal
                isOpen={isProcessing}
                videoUrl={url}
                engine={engine}
                userId={userId}
                onClose={() => setIsProcessing(false)}
            />

            <style jsx global>{`
                @keyframes fade-in {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in {
                    animation: fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                @keyframes pulse-slow {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.6; transform: scale(1.05); }
                }
                .animate-pulse-slow {
                    animation: pulse-slow 8s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}
