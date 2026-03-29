import { NextRequest, NextResponse } from 'next/server';
import { processingStatus } from '@/lib/status-store';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const processingId = searchParams.get('id');

    console.log(`[STATUS API] Checking status for: ${processingId}`);
    console.log(`[STATUS API] Map size: ${processingStatus.size}`);
    console.log(`[STATUS API] All keys:`, Array.from(processingStatus.keys()));

    if (!processingId) {
        return NextResponse.json({ error: 'Processing ID required' }, { status: 400 });
    }

    const status = processingStatus.get(processingId);

    if (!status) {
        console.log(`[STATUS API] NOT FOUND: ${processingId}`);
        return NextResponse.json({ error: 'Processing not found' }, { status: 404 });
    }

    console.log(`[STATUS API] Found status:`, status);
    return NextResponse.json(status);
}
