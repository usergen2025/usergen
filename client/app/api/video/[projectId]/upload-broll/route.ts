import { NextRequest, NextResponse } from 'next/server';

const VIDEO_SERVICE_URL =
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { success: false, message: 'File is required' },
        { status: 400 },
      );
    }

    const uploadFormData = new FormData();
    uploadFormData.append('file', file, (file as File).name || 'broll');

    const url = `${VIDEO_SERVICE_URL}/video-projects/${encodeURIComponent(
      projectId,
    )}/upload-broll`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: request.headers.get('Authorization') || '',
      },
      body: uploadFormData,
    });

    const text = await response.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: 'Invalid JSON response', raw: text };
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          message: data?.message || 'Failed to upload B-roll',
          details: data,
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('[Video API Proxy] upload-broll error:', error?.message || error);
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
