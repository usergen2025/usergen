import { NextRequest, NextResponse } from 'next/server';

const MEDIA_SERVICE_URL = process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL || 'http://localhost:9009';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const url = `${MEDIA_SERVICE_URL}/api/stock/${id}/download?${searchParams.toString()}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Stock Download Proxy] Error from media service: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: 'Failed to download stock media', details: errorText },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('[Stock Download Proxy] Error:', error.message);
    return NextResponse.json(
      { error: 'Failed to connect to stock media service', details: error.message },
      { status: 503 }
    );
  }
}
