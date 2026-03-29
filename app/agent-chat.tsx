'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { chatWithAgent } from './actions';

interface Message {
    id: string;
    role: 'user' | 'agent';
    content: string;
    timestamps?: Array<{ start: string; end: string; videoUrl?: string }>;
}

export default function AgentChat() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationId, setConversationId] = useState<string | undefined>(undefined);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const normalizeTimestamp = (ts: string) => {
        if (!ts) return '00:00:00,000';
        let parts = ts.replace(/[,.]/g, ':').split(':');

        if (parts.length === 2) {
            return `00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')},000`;
        }
        if (parts.length === 3) {
            if (parts[2].length > 2) {
                return `00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')},${parts[2].padEnd(3, '0')}`;
            }
            return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')},000`;
        }
        if (parts.length === 4) {
            return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')},${parts[3].padEnd(3, '0')}`;
        }
        return ts;
    };

    const parseTimestamps = (content: string) => {
        const timestamps: Array<{ start: string; end: string; videoUrl?: string }> = [];
        const urlMatch = content.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        const videoUrl = urlMatch ? urlMatch[0] : undefined;

        // 1. Extract ALL timestamp-like strings
        const tsRegex = /((?:\d{1,2}:){1,2}\d{1,2}(?:[.,]\d+)?)/g;
        const rawMatches = Array.from(content.matchAll(tsRegex));

        if (rawMatches.length < 2) return timestamps;

        // 2. Pair them up based on surrounding context
        const rangeWords = ['to', 'and', 'through', 'until', '-', '–', '—', 'between'];

        for (let i = 0; i < rawMatches.length - 1; i++) {
            const startValue = rawMatches[i][1];
            const endValue = rawMatches[i + 1][1];

            const startIndex = (rawMatches[i].index || 0) + startValue.length;
            const endIndex = rawMatches[i + 1].index || 0;
            const between = content.substring(startIndex, endIndex).toLowerCase();

            const isRange = rangeWords.some(w => between.includes(w));
            const isClose = between.trim().length < 20;
            const preContext = content.substring(Math.max(0, (rawMatches[i].index || 0) - 30), rawMatches[i].index || 0).toLowerCase();
            const hasStartLabel = preContext.includes('start') || preContext.includes('from');

            if (isRange || isClose || hasStartLabel) {
                timestamps.push({
                    start: normalizeTimestamp(startValue),
                    end: normalizeTimestamp(endValue),
                    videoUrl
                });
                i++;
            }
        }

        return timestamps;
    };

    const calculateDuration = (start: string, end: string) => {
        const parseTime = (timeStr: string) => {
            const [h, m, sMs] = timeStr.split(':');
            const [s, ms] = sMs.split(',');
            return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
        };
        return Math.round(parseTime(end) - parseTime(start));
    };

    const handleTimestampClick = (ts: { start: string; end: string; videoUrl?: string }) => {
        // Dispatch event for workspace to pick up
        const event = new CustomEvent('app:preview-timestamp', { detail: ts });
        window.dispatchEvent(event);

        // Fallback: if not in workspace or just want to open anyway
        if (ts.videoUrl && !window.location.pathname.startsWith('/transcripts')) {
            const startTime = Math.floor(parseTime(ts.start));
            window.open(`${ts.videoUrl}&t=${startTime}s`, '_blank');
        }
    };

    const parseTime = (timeStr: string) => {
        const [h, m, sMs] = timeStr.split(':');
        const [s, ms] = sMs.split(',');
        return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await chatWithAgent(userMessage.content, conversationId);
            if (response && response.reply) {
                setConversationId(response.conversation_id);
                setMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(),
                    role: 'agent',
                    content: response.reply,
                    timestamps: parseTimestamps(response.reply)
                }]);
            }
        } catch (error) {
            console.error('Chat error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed bottom-10 right-10 z-50 flex flex-col items-end">
            {isOpen && (
                <div className="w-[380px] h-[550px] mb-6 flex flex-col glass-card rounded-[2rem] border-white/5 overflow-hidden animate-fade-in shadow-[0_25px_80px_rgba(0,0,0,0.6)]">
                    <div className="flex-shrink-0 flex items-center justify-between px-6 py-5 border-b border-white/5 bg-white/[0.02] backdrop-blur-xl">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Assistant</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-neutral-500 hover:text-white transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-6 bg-black/20">
                        {messages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center opacity-20 px-8 text-center mt-[-40px]">
                                <svg className="w-12 h-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                                <p className="text-xs font-light italic leading-loose">"Ask me anything about your segments, transcripts, or search indexes"</p>
                            </div>
                        )}
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex flex-col w-full ${msg.role === 'user' ? 'items-end' : 'items-start animate-fade-in'}`}>
                                <div className={`max-w-[85%] rounded-[1.25rem] px-5 py-3 text-sm leading-relaxed ${msg.role === 'user'
                                    ? 'bg-white text-black font-semibold'
                                    : 'bg-white/5 border border-white/5 text-neutral-300'
                                    }`}>
                                    {msg.role === 'agent' ? (
                                        <div className="prose">
                                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                                        </div>
                                    ) : (
                                        msg.content
                                    )}
                                </div>
                                {msg.role === 'agent' && msg.timestamps && msg.timestamps.length > 0 && (
                                    <div className="mt-3 flex flex-col gap-2 relative">
                                        <div className="flex flex-wrap gap-2 px-2 pb-1 relative z-10">
                                            {msg.timestamps.map((ts, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => handleTimestampClick({ ...ts })}
                                                    className="group/pill px-4 py-2 rounded-2xl bg-white/10 hover:bg-white border border-white/20 hover:border-white text-[11px] font-bold text-white hover:text-black transition-all duration-500 flex items-center gap-3 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] active:scale-95"
                                                >
                                                    <div className="w-5 h-5 rounded-full bg-rose-500/30 group-hover/pill:bg-rose-500/10 flex items-center justify-center transition-colors">
                                                        <svg className="w-2.5 h-2.5 text-rose-500" fill="currentColor" viewBox="0 0 24 24">
                                                            <path d="M8 5v14l11-7z" />
                                                        </svg>
                                                    </div>
                                                    <div className="flex flex-col items-start leading-none gap-1">
                                                        <span className="tabular-nums font-mono tracking-tight opacity-90 group-hover/pill:opacity-100">{ts.start.split(',')[0]} - {ts.end.split(',')[0]}</span>
                                                    </div>
                                                    <span className="px-1.5 py-0.5 rounded-md bg-white/5 group-hover/pill:bg-black/5 text-[8px] opacity-60 transition-colors">
                                                        {calculateDuration(ts.start, ts.end)}s
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex gap-2 p-1 animate-pulse opacity-40">
                                <div className="w-1 h-1 bg-white rounded-full"></div>
                                <div className="w-1 h-1 bg-white rounded-full"></div>
                                <div className="w-1 h-1 bg-white rounded-full"></div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <form onSubmit={handleSubmit} className="flex-shrink-0 p-4 bg-white/[0.02] border-t border-white/5">
                        <div className="flex items-center gap-3">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Message..."
                                className="flex-1 glass-input rounded-2xl px-5 py-3 text-sm outline-none"
                                disabled={isLoading}
                            />
                            <button
                                type="submit"
                                disabled={!input.trim() || isLoading}
                                className="w-10 h-10 flex items-center justify-center rounded-xl bg-white text-black hover:bg-neutral-200 transition-all font-bold disabled:opacity-20"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-14 h-14 rounded-2xl bg-white text-black shadow-[0_10px_40px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95 transition-all duration-500 flex items-center justify-center group"
            >
                <div className={`transition-all duration-500 ${isOpen ? 'rotate-90 opacity-0' : 'rotate-0 opacity-100'}`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                </div>
                <div className={`absolute transition-all duration-500 ${isOpen ? 'rotate-0 opacity-100' : '-rotate-90 opacity-0'}`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
            </button>
        </div>
    );
}
