import { NextRequest, NextResponse } from 'next/server';

const MEDIA_SERVICE_URL = process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL || 'http://localhost:9009';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: musicId } = await params;
  try {
    if (!musicId || !/^\d+$/.test(musicId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid music id' },
        { status: 400 },
      );
    }

    const url = `${MEDIA_SERVICE_URL}/api/stock/music/${musicId}/preview-info`;

    const response = await fetch(url, {
      headers: {
        Authorization: request.headers.get('Authorization') || '',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Music Preview Info Proxy] ${response.status} - ${errorText}`);
      return NextResponse.json(
        { success: false, error: 'Failed to get preview info', details: errorText },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('[Music Preview Info Proxy]', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to media service', details: error?.message },
      { status: 503 },
    );
  }
}
