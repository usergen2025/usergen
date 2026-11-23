import { NextRequest, NextResponse } from 'next/server';

const VIDEO_SERVICE_URL =
  process.env.VIDEO_SERVICE_URL ||
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL ||
  'http://localhost:9004/api';

/**
 * Proxy multipart translation-source uploads to the video service so the
 * browser does not hit CORS limits on large FormData posts.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get('authorization') || '';
    const contentType = request.headers.get('content-type') || '';

    let upstream: Response;

    if (contentType.includes('application/json')) {
      const body = await request.text();
      upstream = await fetch(`${VIDEO_SERVICE_URL}/video-projects/translation-source`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: auth } : {}),
        },
        body,
      });
    } else {
      const incoming = await request.formData();
      const file = incoming.get('file');
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json(
          { success: false, error: 'Video file is required' },
          { status: 400 },
        );
      }

      const uploadFormData = new FormData();
      uploadFormData.append(
        'file',
        file,
        file instanceof File ? file.name : 'video.mp4',
      );

      upstream = await fetch(`${VIDEO_SERVICE_URL}/video-projects/translation-source`, {
        method: 'POST',
        headers: auth ? { Authorization: auth } : undefined,
        body: uploadFormData,
      });
    }

    const text = await upstream.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { success: false, error: text || 'Upstream error' };
    }

    return NextResponse.json(json, { status: upstream.status });
  } catch (error: any) {
    console.error('[Video API Proxy] translation-source error:', error?.message || error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Upload failed' },
      { status: 500 },
    );
  }
}
