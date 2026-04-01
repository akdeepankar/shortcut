import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request: NextRequest) {
    try {
        const { text, voiceId = 'wWWn96OtTHu1sn8SRGEr' } = await request.json(); // Default: Bella
        const apiKey = process.env.ELEVENLABS_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured' }, { status: 500 });
        }

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail?.message || 'ElevenLabs API error');
        }

        const data = await response.json();
        const audioBuffer = Buffer.from(data.audio_base64, 'base64');
        const alignment = data.alignment;

        // Save to temp file
        const tempDir = path.join(process.cwd(), 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        const filename = `voiceover_${Date.now()}.mp3`;
        const filepath = path.join(tempDir, filename);
        await fs.writeFile(filepath, Buffer.from(audioBuffer));

        return NextResponse.json({
            success: true,
            audioUrl: `/api/serve-clip/${filename}`,
            filename,
            alignment
        });

    } catch (error: any) {
        console.error('Synthesis error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
