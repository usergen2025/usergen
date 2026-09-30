import { NextResponse } from 'next/server';

const VIDEO_SERVICE_URL =
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;
  const upstream = await fetch(
    `${VIDEO_SERVICE_URL}/video-projects/shared/${encodeURIComponent(shareId)}`,
  );
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  });
}
