import { NextRequest, NextResponse } from 'next/server';

const MEDIA_SERVICE_URL = process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL || 'http://localhost:9009';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = `${MEDIA_SERVICE_URL}/api/stock/music/search?${searchParams.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: request.headers.get('Authorization') || '',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Music API Proxy] ${response.status} - ${errorText}`);
      return NextResponse.json(
        { success: false, error: 'Music search failed', details: errorText },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('[Music API Proxy]', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to media service', details: error?.message },
      { status: 503 },
    );
  }
}
