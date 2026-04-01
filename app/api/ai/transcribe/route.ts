import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/cloudflare';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await transcribeAudio(buffer);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Transcription error:', error);
        return NextResponse.json({ 
            error: 'Cloudflare Transcription failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
