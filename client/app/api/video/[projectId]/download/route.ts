import { NextRequest, NextResponse } from 'next/server';

const VIDEO_SERVICE_URL =
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const disposition = request.nextUrl.searchParams.get('disposition');
  const qs = disposition === 'inline' ? '?disposition=inline' : '';

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, message: 'Please log in to download' },
      { status: 401 },
    );
  }

  try {
    const upstream = await fetch(
      `${VIDEO_SERVICE_URL}/video-projects/${encodeURIComponent(projectId)}/download${qs}`,
      {
        headers: {
          Authorization: authHeader,
        },
      },
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      let message = 'Download failed';
      try {
        const parsed = JSON.parse(text);
        message = parsed?.message || parsed?.error || message;
      } catch {
        if (text) message = text.slice(0, 200);
      }
      return NextResponse.json({ success: false, message }, { status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    const contentDisposition = upstream.headers.get('content-disposition');
    const contentLength = upstream.headers.get('content-length');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
    };
    if (contentDisposition) {
      headers['Content-Disposition'] = contentDisposition;
    }
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Video download proxy]', message);
    return NextResponse.json(
      { success: false, message: 'Failed to connect to video service', details: message },
      { status: 503 },
    );
  }
}
