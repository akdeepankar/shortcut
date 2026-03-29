interface DeleteModalProps {
    isOpen: boolean;
    indexName: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function DeleteModal({ isOpen, indexName, onConfirm, onCancel }: DeleteModalProps) {
    if (!isOpen) return null;

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
                        <line x1="10" x2="10" y1="11" y2="17" />
                        <line x1="14" x2="14" y1="11" y2="17" />
                    </svg>
                </div>

                {/* Content */}
                <h3 className="text-lg font-semibold text-white text-center mb-2">
                    Delete Index
                </h3>
                <p className="text-sm text-neutral-400 text-center mb-1">
                    Are you sure you want to delete the index
                </p>
                <p className="text-sm font-mono text-white text-center bg-neutral-800 px-3 py-1.5 rounded-md mb-6">
                    {indexName}
                </p>
                <p className="text-xs text-neutral-500 text-center mb-6">
                    This action cannot be undone. All data in this index will be permanently deleted.
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
                        Delete Index
                    </button>
                </div>
            </div>
        </div>
    );
}
