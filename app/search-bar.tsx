'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export default function SearchBar({ basePath = '/' }: { basePath?: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    // Initialize state lazily or just rely on key to reset component when URL changes
    // Actually, we want the input to retain value while typing.
    // The warning was about effect.
    // We can just use defaultValue and key={query} if we want full reset, 
    // but if we want controlled input that updates from URL back/forward, 
    // we do need sync. 
    // Getting `q` from searchParams during render is fine for initial state 
    // IF we accept that navigating back might not update the input if we don't sync.
    // But standard way:

    const initialQuery = searchParams.get('q') || '';
    const [query, setQuery] = useState(initialQuery);

    // We can skip the effect if we key the component in the parent,
    // but since it's in the layout/page, let's just use key logic inside or 
    // a key on the form in the parent.
    // A simpler fix for the lint:

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        startTransition(() => {
            router.push(`${basePath}?q=${encodeURIComponent(query)}`);
        });
    };

    return (
        <form onSubmit={handleSearch} className="w-full max-w-xl mx-auto relative group">
            <div className="relative flex items-center bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-sm transition-all duration-200 focus-within:shadow-md focus-within:border-neutral-300 dark:focus-within:border-neutral-700">
                <div className="pl-4 text-neutral-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for nature..."
                    className="w-full px-3 py-3 bg-transparent border-none outline-none text-base text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 font-medium"
                />
                <div className="pr-2">
                    <button
                        type="submit"
                        disabled={isPending}
                        className="p-2 bg-neutral-900 dark:bg-white text-white dark:text-black rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                        aria-label="Search"
                    >
                        {isPending ? (
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
        </form>
    );
}
