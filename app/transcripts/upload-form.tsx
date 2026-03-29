'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadForm() {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState('');
    const router = useRouter();

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setMessage('');
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setUploading(true);
        setMessage('Uploading and indexing...');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();

            if (res.ok) {
                setMessage(`Success! Indexed ${data.count} segments.`);
                setFile(null);
                // Refresh the page to potentially reset state or trigger re-render if needed
                router.refresh();
            } else {
                setMessage(`Error: ${data.error}`);
            }
        } catch (err) {
            setMessage('Upload failed.');
            console.error(err);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="w-full max-w-xl p-8 bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm mb-12">
            <h3 className="text-xl font-semibold mb-4 text-neutral-900 dark:text-neutral-100">Upload Transcript</h3>
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-xl p-6 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors mb-4">
                <input
                    type="file"
                    accept=".srt"
                    onChange={handleFileChange}
                    className="hidden"
                    id="srt-upload"
                />
                <label htmlFor="srt-upload" className="cursor-pointer flex flex-col items-center w-full">
                    <span className="text-4xl mb-2">📄</span>
                    <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400 text-center">
                        {file ? file.name : "Click to upload .srt file"}
                    </span>
                </label>
            </div>

            <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="w-full py-3 bg-neutral-900 dark:bg-white text-white dark:text-black rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {uploading ? 'Uploading...' : 'Index Transcript'}
            </button>

            {message && (
                <p className={`mt-4 text-sm ${message.startsWith('Error') ? 'text-red-500' : 'text-green-600'} dark:text-neutral-400`}>
                    {message}
                </p>
            )}
        </div>
    );
}
