import { NextRequest, NextResponse } from 'next/server';

const VIDEO_SERVICE_URL =
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  try {
    const upstream = await fetch(
      `${VIDEO_SERVICE_URL}/video-projects/${encodeURIComponent(projectId)}/download-url`,
      {
        headers: {
          Authorization: request.headers.get('Authorization') || '',
        },
      },
    );

    const body = await upstream.json();
    return NextResponse.json(body, { status: upstream.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Video download-url proxy]', message);
    return NextResponse.json(
      { success: false, message: 'Failed to connect to video service', details: message },
      { status: 503 },
    );
  }
}
