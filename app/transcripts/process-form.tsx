'use client';

import { useState } from 'react';
export default function ProcessForm() {
    const [url, setUrl] = useState('');
    const [engine, setEngine] = useState<'openai' | 'elevenlabs'>('openai');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!url.trim()) return;

        const youtubeRegex = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})(?:&.*)?$/i;

        if (!youtubeRegex.test(url.trim())) {
            alert('Please enter a valid YouTube URL');
            return;
        }

        // Dispatch global event for the main workspace to handle processing
        window.dispatchEvent(new CustomEvent('app:process-video', {
            detail: { url: url.trim(), engine }
        }));

        setUrl(''); // Clear input
    };

    return (
        <div className="flex-1 max-w-2xl">
            <form onSubmit={handleSubmit} className="animate-fade-in transition-all">
                <div className="flex items-center gap-2 p-1.5 bg-white/[0.03] border border-white/10 rounded-xl glass-card backdrop-blur-3xl group focus-within:border-white/20 transition-all shadow-xl shadow-black/20">
                    <div className="pl-4 text-neutral-500 group-focus-within:text-white transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <input
                        type="url"
                        placeholder="Ingest another masterpiece..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="flex-1 bg-transparent border-none text-white placeholder:text-neutral-500 focus:ring-0 px-3 py-3 text-sm font-light select-none outline-none"
                    />

                    <div className="flex items-center gap-1 p-1 bg-white/[0.05] rounded-lg border border-white/5 mx-1">
                        <button
                            type="button"
                            onClick={() => setEngine('openai')}
                            className={`text-[8px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg transition-all ${engine === 'openai' ? 'bg-white text-black shadow-lg shadow-white/10' : 'text-neutral-500 hover:text-white'}`}
                        >
                            Whisper
                        </button>
                        <button
                            type="button"
                            onClick={() => setEngine('elevenlabs')}
                            className={`text-[8px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg transition-all ${engine === 'elevenlabs' ? 'bg-white text-black shadow-lg shadow-white/10' : 'text-neutral-500 hover:text-white'}`}
                        >
                            Scribe
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={!url.trim()}
                        className="px-8 py-3 bg-white text-black font-black rounded-lg hover:bg-neutral-200 transition-all text-xs uppercase tracking-widest disabled:opacity-20 disabled:pointer-events-none active:scale-[0.98]"
                    >
                        Ingest
                    </button>
                </div>
            </form>
        </div>
    );
}
