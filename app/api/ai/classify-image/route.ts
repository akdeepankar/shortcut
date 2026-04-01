import { NextRequest, NextResponse } from 'next/server';
import { classifyImage } from '@/lib/cloudflare';

export async function POST(req: NextRequest) {
    try {
        const { imageBase64 } = await req.json();

        if (!imageBase64) {
            return NextResponse.json({ error: 'No image provided' }, { status: 400 });
        }

        // Remove prefix (data:image/jpeg;base64,...) if present
        const base64Content = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        const result = await classifyImage(base64Content);

        return NextResponse.json({ labels: result });
    } catch (error) {
        console.error('Image Classification error:', error);
        return NextResponse.json({ 
            error: 'Cloudflare Image Classification failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
