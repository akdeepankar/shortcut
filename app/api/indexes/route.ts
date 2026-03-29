import { NextRequest, NextResponse } from 'next/server';
import { listIndexes, deleteIndex } from '@/lib/cloudflare';

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

        if (!indexName) {
            return NextResponse.json({ error: 'Index name required' }, { status: 400 });
        }

        await deleteIndex(indexName);

        return NextResponse.json({ success: true, message: `Index ${indexName} deleted` });
    } catch (error) {
        console.error('Failed to delete index:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

