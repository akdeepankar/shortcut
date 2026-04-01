import { NextResponse } from 'next/server';

export async function GET() {
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    
    if (!ELEVENLABS_API_KEY) {
        return NextResponse.json({ error: 'ElevenLabs API Key not configured' }, { status: 500 });
    }

    try {
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY
            }
        });
        const data = await response.json();
        
        // Map to a cleaner format
        const voices = data.voices.map((v: any) => ({
            id: v.voice_id,
            name: v.name,
            previewUrl: v.preview_url,
            category: v.category,
            labels: v.labels
        }));

        return NextResponse.json({ voices });
    } catch (error) {
        console.error('Failed to fetch voices:', error);
        return NextResponse.json({ error: 'Failed to fetch voices' }, { status: 500 });
    }
}
