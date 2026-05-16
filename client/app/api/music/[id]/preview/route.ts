import { NextRequest, NextResponse } from 'next/server';

const MEDIA_SERVICE_URL = process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL || 'http://localhost:9009';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: musicId } = await params;
  try {
    if (!musicId || !/^\d+$/.test(musicId)) {
      return new NextResponse('Invalid music id', { status: 400 });
    }

    const url = `${MEDIA_SERVICE_URL}/api/stock/music/${musicId}/preview`;

    const response = await fetch(url, {
      headers: {
        Authorization: request.headers.get('Authorization') || '',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Music Preview Stream Proxy] ${response.status} - ${errorText}`);
      return new NextResponse(errorText || 'Failed to stream preview', {
        status: response.status,
      });
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const contentLength = response.headers.get('content-length');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    };
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error('[Music Preview Stream Proxy]', error?.message || error);
    return new NextResponse('Failed to stream preview', { status: 503 });
  }
}
