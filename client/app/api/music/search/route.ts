import { NextRequest, NextResponse } from 'next/server';

// Use HeyGen audio search via Video Processing Service
const VIDEO_SERVICE_URL = process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004';
// Fallback to old Magnific service if HEYGEN_MUSIC_ENABLED is set to false
const MEDIA_SERVICE_URL = process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL || 'http://localhost:9009';
const USE_HEYGEN_MUSIC = process.env.HEYGEN_MUSIC_ENABLED !== 'false';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // If using HeyGen, transform the query parameters and call the HeyGen endpoint
    if (USE_HEYGEN_MUSIC) {
      // Map client params to HeyGen format
      const query = searchParams.get('q') || searchParams.get('query') || 'background music';
      const limit = searchParams.get('limit') || '20';
      
      const heygenParams = new URLSearchParams({
        query,
        type: 'music',
        limit,
        minScore: '0.6',
      });
      
      const url = `${VIDEO_SERVICE_URL}/video-projects/music/search?${heygenParams.toString()}`;
      console.log(`[Music API Proxy] Calling HeyGen endpoint: ${url}`);

      const response = await fetch(url, {
        headers: {
          Authorization: request.headers.get('Authorization') || '',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Music API Proxy] HeyGen ${response.status} - ${errorText}`);
        return NextResponse.json(
          { success: false, error: 'Music search failed', details: errorText },
          { status: response.status },
        );
      }

      const heygenData = await response.json();
      
      // Transform HeyGen response to match expected format for UI
      const tracks = heygenData.data?.tracks || [];
      const transformedResults = tracks.map((track: any, index: number) => ({
        id: track.id,
        source: 'heygen' as const,
        externalId: index + 1, // HeyGen uses string IDs, generate numeric for compatibility
        heygenTrackId: track.id,
        title: track.name || 'Untitled Track',
        artistName: 'HeyGen Music Library',
        previewUrl: track.audio_url, // HeyGen provides pre-signed URL
        audioUrl: track.audio_url,
        duration: track.duration,
        durationSeconds: track.duration,
        seconds: Math.round(track.duration || 0),
        time: formatDuration(track.duration || 0),
        score: track.score,
        description: track.description,
        isPremium: false,
      }));

      return NextResponse.json({
        success: true,
        data: {
          results: transformedResults,
          total: transformedResults.length,
          hasMore: heygenData.data?.hasMore || false,
          relaxLevel: 0,
        },
      });
    }
    
    // Fallback to old Magnific endpoint
    const url = `${MEDIA_SERVICE_URL}/api/stock/music/search?${searchParams.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: request.headers.get('Authorization') || '',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Music API Proxy] Magnific ${response.status} - ${errorText}`);
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
      { success: false, error: 'Failed to connect to music service', details: error?.message },
      { status: 503 },
    );
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
