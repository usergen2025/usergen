import { NextRequest, NextResponse } from 'next/server';

const VIDEO_SERVICE_URL =
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  try {
    const body = await request.json();
    const url = `${VIDEO_SERVICE_URL}/video-projects/${encodeURIComponent(
      projectId,
    )}/process-custom-broll`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('Authorization') || '',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();

    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      console.error(
        '[Video API Proxy] Failed to parse response JSON from video service:',
        err,
      );
      data = { error: 'Invalid JSON response from video service', raw: text };
    }

    if (!response.ok) {
      console.error(
        `[Video API Proxy] Error from video service: ${response.status} - ${text}`,
      );
      return NextResponse.json(
        {
          success: false,
          message: data?.message || 'Failed to process custom B-roll',
          details: data,
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('[Video API Proxy] Error:', error?.message || error);
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to connect to video processing service',
        details: error?.message || String(error),
      },
      { status: 503 },
    );
  }
}

