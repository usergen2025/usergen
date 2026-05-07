import { NextRequest, NextResponse } from 'next/server';

const MEDIA_SERVICE_URL = process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL || 'http://localhost:9009';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const searchParams = request.nextUrl.searchParams;
    const qs = searchParams.toString();
    const url = `${MEDIA_SERVICE_URL}/api/stock/music/${encodeURIComponent(id)}/download${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      headers: {
        Authorization: request.headers.get('Authorization') || '',
        'Content-Type': 'application/json',
      },
    });

    const text = await response.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Download failed', details: data },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('[Music download proxy]', error?.message || error);
    return NextResponse.json(
      { success: false, message: 'Failed to connect to media service', details: error?.message },
      { status: 503 },
    );
  }
}
