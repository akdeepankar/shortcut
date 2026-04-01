import { NextRequest, NextResponse } from 'next/server';
import { listIndexes, deleteIndex, clearIndex } from '@/lib/cloudflare';

export async function GET() {
    try {
        const result = await listIndexes();
        
        // Extract index names
        const indexes = (result.result as any[])
            .map((idx: any) => idx.name);

        return NextResponse.json({ indexes });
    } catch (error) {
        console.error('Failed to fetch indexes:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const indexName = searchParams.get('name');
        const userId = searchParams.get('userId') || 'global';

        if (!indexName) {
            return NextResponse.json({ error: 'Index name required' }, { status: 400 });
        }

        console.log(`[Index Management] Soft clearing index: ${indexName} for User: ${userId}`);
        
        // Safety: Use clearIndex (deletes vectors) instead of deleteIndex (destroys infra)
        // We filter by userId to ensure user-specific data is wiped while keeping others intact
        const result = await clearIndex(indexName, { user_id: userId });

        return NextResponse.json({ 
            success: true, 
            message: `Data cleared from ${indexName}`,
            count: (result as any).count || 0 
        });
    } catch (error) {
        console.error('Failed to clear index data:', error);
        return NextResponse.json({ error: 'Failed to clear data segments.' }, { status: 500 });
    }
}

