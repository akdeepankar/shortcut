import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;
    const filePath = path.join(process.cwd(), 'temp', filename);

    if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stats = fs.statSync(filePath);
    const fileStream = fs.createReadStream(filePath);

    // Convert Node.js stream to Web Stream
    const webStream = new ReadableStream({
        start(controller) {
            fileStream.on('data', (chunk) => controller.enqueue(chunk));
            fileStream.on('end', () => controller.close());
            fileStream.on('error', (err) => controller.error(err));
        },
        cancel() {
            fileStream.destroy();
        }
    });

    return new NextResponse(webStream, {
        headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': stats.size.toString(),
            'Accept-Ranges': 'bytes',
        },
    });
}
