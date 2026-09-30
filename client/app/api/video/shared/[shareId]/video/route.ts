import { NextRequest, NextResponse } from 'next/server';

const VIDEO_SERVICE_URL =
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;
  const disposition = request.nextUrl.searchParams.get('disposition');
  const qs = disposition === 'attachment' ? '?disposition=attachment' : '?disposition=inline';
  const upstream = await fetch(
    `${VIDEO_SERVICE_URL}/video-projects/shared/${encodeURIComponent(shareId)}/video${qs}`,
  );
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ success: false, message: 'Video not available' }, { status: upstream.status || 404 });
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
      'Content-Disposition': upstream.headers.get('content-disposition') || 'inline',
    },
  });
}
