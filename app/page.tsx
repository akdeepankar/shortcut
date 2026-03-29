'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AgentChat from './agent-chat';
import SettingsModal from './components/settings-modal';
import ProcessingModal from './components/processing-modal';

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [engine, setEngine] = useState<'openai' | 'elevenlabs'>('openai');
  const [showSettings, setShowSettings] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

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

      {/* Background radial gradient for depth */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/[0.02] rounded-full blur-[120px] pointer-events-none"></div>

      {/* Navbar */}
      <nav className="flex items-center justify-between px-8 py-8 md:px-16 max-w-7xl mx-auto w-full z-10">
        <div className="flex items-center gap-3 group cursor-pointer" onClick={() => router.push('/')}>
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center transition-all duration-500 group-hover:rotate-[360deg] group-hover:rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.1)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-black">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
              <path d="M18 2h-4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
            </svg>
          </div>
          <span className="text-2xl font-bold tracking-tighter text-white">Clipper</span>
        </div>

        <div className="flex items-center gap-8">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-white transition-all uppercase tracking-widest"
          >
            Settings
          </button>
          <button className="px-6 py-3 glass-card hover:bg-white hover:text-black transition-all rounded-xl text-xs font-bold uppercase tracking-widest shadow-xl border-white/5">
            Docs
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 relative mt-[-60px] z-10">
        <div className="inline-flex items-center justify-center px-4 py-1.5 mb-10 rounded-full bg-white/[0.03] border border-white/[0.08] backdrop-blur-md animate-fade-in">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Next-Gen Video Intelligence</span>
        </div>

        <h1 className="text-6xl md:text-8xl font-bold tracking-tight text-white mb-8 max-w-5xl leading-[0.9] animate-fade-in transition-all">
          Zero-Effort<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-b from-white to-neutral-600">Video Extraction</span>
        </h1>

        <p className="max-w-2xl text-lg text-neutral-500 mb-14 leading-relaxed font-light animate-fade-in opacity-80 decoration-transparent">
          The fastest way to transform raw content into shareable moments. Powered by word-level semantic intelligence.
        </p>

        {/* Input Area */}
        <form onSubmit={handleGetStarted} className="w-full max-w-3xl animate-fade-in">
          <div className="flex items-center p-2 bg-white/[0.02] border border-white/[0.08] rounded-3xl backdrop-blur-3xl group shadow-[0_20px_50px_rgba(0,0,0,0.5)] transition-all focus-within:border-white/20">
            <div className="pl-6 text-neutral-600 group-focus-within:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>

            <input
              type="url"
              placeholder="Paste YouTube Link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 bg-transparent border-none text-white placeholder:text-neutral-700 focus:ring-0 px-6 py-5 text-base font-medium outline-none"
            />

            <div className="flex items-center gap-1.5 p-1 bg-white/[0.03] rounded-2xl border border-white/5 mr-1.5">
              <button
                type="button"
                onClick={() => setEngine('openai')}
                className={`px-5 py-2.5 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all ${engine === 'openai' ? 'bg-white text-black shadow-lg shadow-white/10' : 'text-neutral-500 hover:text-white'}`}
              >
                Whisper
              </button>
              <button
                type="button"
                onClick={() => setEngine('elevenlabs')}
                className={`px-5 py-2.5 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all ${engine === 'elevenlabs' ? 'bg-white text-black shadow-lg shadow-white/10' : 'text-neutral-500 hover:text-white'}`}
              >
                ElevenLabs
              </button>
            </div>

            <button
              type="submit"
              className="px-10 py-5 bg-white text-black font-black rounded-2xl hover:bg-neutral-200 transition-all text-xs uppercase tracking-[0.1em] shadow-[0_0_30px_rgba(255,255,255,0.1)] active:scale-95"
            >
              Analyze
            </button>
          </div>

          <div className="mt-8 flex items-center justify-center gap-6 animate-fade-in">
            <button
              type="button"
              onClick={() => router.push('/transcripts')}
              className="text-xs font-bold uppercase tracking-widest text-neutral-500 hover:text-white transition-all flex items-center gap-2"
            >
              Recent Libraries
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
          </div>
        </form>
      </main>

      {/* Footer */}
      <footer className="py-12 text-center z-10 px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between border-t border-white/5 pt-8">
          <p className="text-[10px] uppercase tracking-widest text-neutral-600 font-bold">&copy; {new Date().getFullYear()} Clipper AI Research</p>
          <div className="flex gap-8 text-[10px] uppercase tracking-widest text-neutral-600 font-bold">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Github</a>
          </div>
        </div>
      </footer>

      {/* Agent Chat */}
      <AgentChat />

      {/* Settings Modal */}
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {/* Processing Modal Replacement for Page */}
      <ProcessingModal
        isOpen={isProcessing}
        videoUrl={url}
        engine={engine}
        onClose={() => setIsProcessing(false)}
      />
    </div>
  );
}
