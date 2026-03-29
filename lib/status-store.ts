// Use global singleton to ensure same Map instance across all API routes in Next.js
declare global {
    var processingStatusMap: Map<string, {
        stage: string;
        message: string;
        progress: number;
        error?: string;
        complete: boolean;
    }> | undefined;
}

// Initialize or reuse the global Map
export const processingStatus = global.processingStatusMap || new Map<string, {
    stage: string;
    message: string;
    progress: number;
    error?: string;
    complete: boolean;
}>();

// Store it globally
if (!global.processingStatusMap) {
    global.processingStatusMap = processingStatus;
}

export function updateStatus(processingId: string, update: Partial<{
    stage: string;
    message: string;
    progress: number;
    error?: string;
    complete: boolean;
}>) {
    const current = processingStatus.get(processingId) || {
        stage: 'downloading',
        message: 'Initializing...',
        progress: 0,
        complete: false
    };

    const newStatus = { ...current, ...update };
    processingStatus.set(processingId, newStatus);
    console.log(`[STATUS] Updated ${processingId}:`, newStatus);
    console.log(`[STATUS] Map size: ${processingStatus.size}`);
}

export function initStatus(processingId: string) {
    const status = {
        stage: 'downloading',
        message: 'Initializing...',
        progress: 0,
        complete: false
    };
    processingStatus.set(processingId, status);
    console.log(`[STATUS] Initialized ${processingId}:`, status);
    console.log(`[STATUS] Map size: ${processingStatus.size}`);
}
