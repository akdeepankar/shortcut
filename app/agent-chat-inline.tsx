'use client';

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import ReactMarkdown from 'react-markdown';
import { chatWithAgent } from './actions';

interface Message {
    id: string;
    role: 'user' | 'agent';
    content: string;
    timestamps?: Array<{ start: string; end: string; videoUrl?: string }>;
    rawContext?: string;
}

export interface AgentChatHandle {
    clearMessages: () => void;
}

interface AgentChatInlineProps {
    onTimestampClick?: (timestamp: { start: string; end: string; videoUrl?: string }) => void;
    videoUrl?: string;
    onDebugClick?: (content: string) => void;
}

const AgentChatInline = forwardRef<AgentChatHandle, AgentChatInlineProps>(({ onTimestampClick, videoUrl: propVideoUrl, onDebugClick }, ref) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationId, setConversationId] = useState<string | undefined>(undefined);
    const [userId, setUserId] = useState<string>('global');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const id = localStorage.getItem('clipper_user_id');
        if (id) setUserId(id);
    }, []);

    useImperativeHandle(ref, () => ({
        clearMessages: () => {
            setMessages([]);
            setConversationId(undefined);
        }
    }));

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const normalizeTimestamp = (ts: string) => {
        if (!ts) return '00:00:00,000';
        let parts = ts.replace(',', ':').split(':');

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

            // Get text between matches
            const startIndex = (rawMatches[i].index || 0) + startValue.length;
            const endIndex = rawMatches[i + 1].index || 0;
            const between = content.substring(startIndex, endIndex).toLowerCase();

            // If they are paired by range words or just very close together (segments)
            const isRange = rangeWords.some(w => between.includes(w));
            const isClose = between.trim().length < 15;
            const hasStartLabel = content.substring(Math.max(0, (rawMatches[i].index || 0) - 20), rawMatches[i].index || 0).toLowerCase().includes('start');

            if (isRange || isClose || hasStartLabel) {
                timestamps.push({
                    start: normalizeTimestamp(startValue),
                    end: normalizeTimestamp(endValue),
                    videoUrl
                });
                i++; // Skip the end timestamp in next iteration
            }
        }

        return timestamps;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const history = messages.map(m => ({
                role: m.role === 'agent' ? 'assistant' : 'user',
                content: m.content
            }));
            const response = await chatWithAgent(
                userMsg.content, 
                conversationId, 
                userId, 
                propVideoUrl
            );
            
            console.log('[AgentChat] Server Response:', response);

            if (response && !('error' in response)) {
                // Return structure includes { reply, timestamps, rawContext }
                const agentMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'agent',
                    content: response.reply || '',
                    timestamps: parseTimestamps(response.reply || ''),
                    rawContext: (response as any).rawContext || "No underlying context was provided to the AI for this specific query."
                };
                setMessages(prev => [...prev, agentMsg]);
                setConversationId(response.conversation_id);
            }
        } catch (error) {
            console.error('Chat error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const formatTimestamp = (ts: string) => {
        if (!ts) return "";
        const base = ts.split(/[.,]/)[0]; // Remove milliseconds
        return base.startsWith('00:') ? base.substring(3) : base;
    };

    const calculateDuration = (start: string, end: string) => {
        const parse = (s: string) => {
            const [hms, ms] = s.split(',');
            const [h, m, sec] = hms.split(':').map(Number);
            return h * 3600 + m * 60 + sec + (ms ? parseInt(ms) / 1000 : 0);
        };
        const dur = parse(end) - parse(start);
        return isNaN(dur) ? "0.0" : dur.toFixed(1);
    };

    return (
        <div className="flex flex-col h-full glass-card rounded-2xl overflow-hidden">
            <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-40">
                        <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                        <p className="text-sm">Start a conversation about your transcripts</p>
                    </div>
                )}
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start animate-fade-in'}`}>
                        <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed relative group/msg ${msg.role === 'user'
                            ? 'bg-white text-black font-medium'
                            : 'bg-white/5 border border-white/10 text-neutral-200'
                            }`}>
                            {msg.role === 'agent' ? (
                                <div className="prose min-h-[40px] pr-8 relative">
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    
                                    {msg.rawContext && (
                                        <button 
                                            onClick={() => onDebugClick?.(msg.rawContext || "")}
                                            className="absolute top-1 -right-1 p-2 rounded-lg bg-white/5 text-neutral-500 hover:text-rose-400 hover:bg-white/10 transition-all z-20 group-hover/msg:bg-rose-500 group-hover/msg:text-white"
                                            title="Inspect Semantic Bridge"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </button>
                                    )}
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
                                            onClick={() => onTimestampClick?.({ ...ts })}
                                            className="group/pill px-4 py-2 rounded-2xl bg-white/10 hover:bg-white border border-white/20 hover:border-white text-[11px] font-bold text-white hover:text-black transition-all duration-500 flex items-center gap-3 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] active:scale-95"
                                        >
                                            <div className="w-5 h-5 rounded-full bg-rose-500/30 group-hover/pill:bg-rose-500/10 flex items-center justify-center transition-colors">
                                                <svg className="w-2.5 h-2.5 text-rose-500" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </div>
                                            <div className="flex flex-col items-start leading-none gap-1">
                                                <span className="tabular-nums font-mono tracking-tight opacity-90 group-hover/pill:opacity-100">{formatTimestamp(ts.start)} - {formatTimestamp(ts.end)}</span>
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
                    <div className="flex items-center space-x-2 animate-pulse px-4">
                        <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                        <div className="w-1.5 h-1.5 bg-white rounded-full animation-delay-200"></div>
                        <div className="w-1.5 h-1.5 bg-white rounded-full animation-delay-400"></div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="flex-shrink-0 p-4 bg-black/40 border-t border-white/5 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask anything..."
                        className="flex-1 glass-input rounded-xl px-4 py-2 text-sm outline-none"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isLoading}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-white text-black hover:bg-neutral-200 disabled:opacity-30 transition-all font-bold"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                    </button>
                </div>
            </form>
        </div>
    );
});

AgentChatInline.displayName = 'AgentChatInline';
export default AgentChatInline;
