'use client';

interface ClearModalProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    type: 'agent' | 'transcripts' | 'all';
}

export default function ClearModal({ isOpen, onConfirm, onCancel, type }: ClearModalProps) {
    if (!isOpen) return null;

    const titles = {
        agent: 'Clear Chat History',
        transcripts: 'Delete All Transcripts',
        all: 'Clear All Data'
    };

    const messages = {
        agent: 'Are you sure you want to clear all messages in the agent chat? This will restart the conversation.',
        transcripts: 'Are you sure you want to delete all processed transcripts? This will permanently remove them from the index.',
        all: 'Are you sure you want to clear the agent chat and all transcript data? This action cannot be undone.'
    };

    const buttonText = {
        agent: 'Clear Chat',
        transcripts: 'Delete Transcripts',
        all: 'Clear Everything'
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onCancel}
            />

            {/* Modal */}
            <div className="relative bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                {/* Icon */}
                <div className="w-12 h-12 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                </div>

                {/* Content */}
                <h3 className="text-lg font-semibold text-white text-center mb-2">
                    {titles[type]}
                </h3>
                <p className="text-sm text-neutral-400 text-center mb-6">
                    {messages[type]}
                </p>

                {/* Actions */}
                <div className="flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors text-sm font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium"
                    >
                        {buttonText[type]}
                    </button>
                </div>
            </div>
        </div>
    );
}
