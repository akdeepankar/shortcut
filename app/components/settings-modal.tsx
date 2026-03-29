'use client';

import { useState, useEffect } from 'react';

export default function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const [openaiKey, setOpenaiKey] = useState('');
    const [elevenlabsKey, setElevenlabsKey] = useState('');

    useEffect(() => {
        if (isOpen) {
            const savedOpenai = localStorage.getItem('openai_api_key');
            if (savedOpenai) setOpenaiKey(savedOpenai);

            const savedEleven = localStorage.getItem('elevenlabs_api_key');
            if (savedEleven) setElevenlabsKey(savedEleven);
        }
    }, [isOpen]);

    const handleSave = () => {
        localStorage.setItem('openai_api_key', openaiKey);
        localStorage.setItem('elevenlabs_api_key', elevenlabsKey);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-neutral-800 rounded-lg max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold">Settings</h2>
                    <button
                        onClick={onClose}
                        className="text-neutral-500 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium mb-2">OpenAI API Key</label>
                        <input
                            type="password"
                            value={openaiKey}
                            onChange={(e) => setOpenaiKey(e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-4 py-2 text-sm focus:ring-1 focus:ring-neutral-700 focus:outline-none"
                        />
                        <p className="text-[10px] text-neutral-500 mt-2 uppercase tracking-widest font-bold">
                            Used for OpenAI Whisper
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">ElevenLabs API Key</label>
                        <input
                            type="password"
                            value={elevenlabsKey}
                            onChange={(e) => setElevenlabsKey(e.target.value)}
                            placeholder="Enter your ElevenLabs API key"
                            className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-4 py-2 text-sm focus:ring-1 focus:ring-neutral-700 focus:outline-none"
                        />
                        <p className="text-[10px] text-neutral-500 mt-2 uppercase tracking-widest font-bold">
                            Used for ElevenLabs Scribe
                        </p>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button
                            onClick={handleSave}
                            className="flex-1 bg-white text-black px-4 py-2 rounded-md hover:bg-neutral-200 transition-colors font-medium text-sm"
                        >
                            Save Configuration
                        </button>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 border border-neutral-800 rounded-md hover:bg-neutral-900 transition-colors text-sm"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
