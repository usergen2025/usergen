import { NextRequest, NextResponse } from 'next/server';

// Use HeyGen audio search via Video Processing Service
const VIDEO_SERVICE_URL = process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004';
// Fallback to Magnific when HeyGen returns nothing (or HEYGEN_MUSIC_ENABLED=false)
const MEDIA_SERVICE_URL = process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL || 'http://localhost:9009';
const USE_HEYGEN_MUSIC = process.env.HEYGEN_MUSIC_ENABLED !== 'false';

/** Primary HeyGen similarity floor — 0.6 was too strict for niche script topics. */
const HEYGEN_MIN_SCORE = '0.35';
/** Second pass when primary still empty. */
const HEYGEN_RELAXED_MIN_SCORE = '0.2';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function transformHeyGenTracks(tracks: any[]) {
  return (tracks || []).map((track: any, index: number) => ({
    id: track.id,
    source: 'heygen' as const,
    externalId: index + 1,
    heygenTrackId: track.id,
    title: track.name || 'Untitled Track',
    artistName: 'HeyGen Music Library',
    previewUrl: track.audio_url,
    audioUrl: track.audio_url,
    duration: track.duration,
    durationSeconds: track.duration,
    seconds: Math.round(track.duration || 0),
    time: formatDuration(track.duration || 0),
    score: track.score,
    description: track.description,
    isPremium: false,
  }));
}

/**
 * Ranked alternate queries: closest topic first, then broader moods so we
 * almost always return at least a few tracks for complex scripts.
 */
function buildRankedQueries(primary: string, moods?: string[], genres?: string[]): string[] {
  const q = (primary || '').trim();
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim().replace(/\s+/g, ' ');
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  if (q) push(q);

  // First N content words (drop very short stop-ish tokens)
  if (q) {
    const words = q
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z0-9'-]/g, ''))
      .filter((w) => w.length > 2);
    if (words.length >= 2) push(words.slice(0, 3).join(' '));
    if (words.length >= 1) push(`${words[0]} background music`);
  }

  for (const m of moods || []) {
    if (m?.trim()) push(`${m.trim()} background music`);
  }
  for (const g of genres || []) {
    if (g?.trim()) push(`${g.trim()} instrumental`);
  }

  push('upbeat background music');
  push('cinematic ambient music');
  push('corporate background music');
  push('soft acoustic background music');
  push('background music');

  return out.slice(0, 8);
}

async function searchHeyGen(
  query: string,
  authHeader: string,
  limit: string,
  minScore: string,
): Promise<{ tracks: any[]; hasMore: boolean; status: number; errorText?: string }> {
  const heygenParams = new URLSearchParams({
    query,
    type: 'music',
    limit,
    minScore,
  });
  const url = `${VIDEO_SERVICE_URL}/video-projects/music/search?${heygenParams.toString()}`;
  console.log(`[Music API Proxy] HeyGen query="${query}" minScore=${minScore}`);

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { tracks: [], hasMore: false, status: response.status, errorText };
  }

  const heygenData = await response.json();
  return {
    tracks: heygenData.data?.tracks || [],
    hasMore: !!heygenData.data?.hasMore,
    status: 200,
  };
}

async function searchMagnific(
  searchParams: URLSearchParams,
  authHeader: string,
): Promise<{ status: number; body: any } | null> {
  try {
    const url = `${MEDIA_SERVICE_URL}/api/stock/music/search?${searchParams.toString()}`;
    console.log(`[Music API Proxy] Magnific fallback: ${url}`);
    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Music API Proxy] Magnific ${response.status} - ${errorText}`);
      return null;
    }
    const data = await response.json();
    if (data?.data && typeof data.data === 'object') {
      data.data.relaxLevel = Math.max(Number(data.data.relaxLevel || 0), 3);
      data.data.source = data.data.source || 'magnific';
    }
    return { status: response.status, body: data };
  } catch (e: any) {
    console.error('[Music API Proxy] Magnific fallback failed:', e?.message || e);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const authHeader = request.headers.get('Authorization') || '';

    if (!USE_HEYGEN_MUSIC) {
      const magnific = await searchMagnific(searchParams, authHeader);
      if (magnific) return NextResponse.json(magnific.body, { status: magnific.status });
      return NextResponse.json(
        { success: false, error: 'Music search failed' },
        { status: 503 },
      );
    }

    const primary =
      searchParams.get('q') || searchParams.get('query') || 'background music';
    const limit = searchParams.get('limit') || '20';
    const moods = (searchParams.get('mood') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const genres = (searchParams.get('genre') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const ranked = buildRankedQueries(primary, moods, genres);
    let relaxLevel = 0;
    let lastError: { status: number; errorText?: string } | null = null;

    // Pass 1: ranked queries at normal (lenient) minScore
    for (let i = 0; i < ranked.length; i++) {
      const result = await searchHeyGen(ranked[i], authHeader, limit, HEYGEN_MIN_SCORE);
      if (result.errorText && result.status >= 400) {
        lastError = result;
        // Auth errors: fail fast
        if (result.status === 401 || result.status === 403) {
          return NextResponse.json(
            { success: false, error: 'Music search failed', details: result.errorText },
            { status: result.status },
          );
        }
        continue;
      }
      if (result.tracks.length > 0) {
        relaxLevel = i;
        return NextResponse.json({
          success: true,
          data: {
            results: transformHeyGenTracks(result.tracks),
            total: result.tracks.length,
            hasMore: result.hasMore,
            relaxLevel,
            queryUsed: ranked[i],
          },
        });
      }
    }

    // Pass 2: same queries with very low minScore
    for (let i = 0; i < Math.min(ranked.length, 5); i++) {
      const result = await searchHeyGen(
        ranked[i],
        authHeader,
        limit,
        HEYGEN_RELAXED_MIN_SCORE,
      );
      if (result.tracks.length > 0) {
        return NextResponse.json({
          success: true,
          data: {
            results: transformHeyGenTracks(result.tracks),
            total: result.tracks.length,
            hasMore: result.hasMore,
            relaxLevel: Math.max(i, 2),
            queryUsed: ranked[i],
          },
        });
      }
    }

    // Pass 3: Magnific stock library
    const magnificParams = new URLSearchParams(searchParams);
    if (!magnificParams.get('q') && !magnificParams.get('query')) {
      magnificParams.set('q', primary);
    }
    const magnific = await searchMagnific(magnificParams, authHeader);
    if (magnific) {
      const body = magnific.body;
      const results = body?.data?.results || body?.results || [];
      if (Array.isArray(results) && results.length > 0) {
        return NextResponse.json({
          ...body,
          success: true,
          data: {
            ...(body.data || {}),
            results,
            relaxLevel: 4,
            queryUsed: primary,
            source: 'magnific',
          },
        });
      }
    }

    // Soft empty success — avoid hard errors so UI can show "No music found" + manual search
    if (lastError?.status && lastError.status >= 500) {
      return NextResponse.json(
        { success: false, error: 'Music search failed', details: lastError.errorText },
        { status: lastError.status },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        results: [],
        total: 0,
        hasMore: false,
        relaxLevel: 5,
        queryUsed: primary,
      },
    });
  } catch (error: any) {
    console.error('[Music API Proxy]', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to music service', details: error?.message },
      { status: 503 },
    );
  }
}
