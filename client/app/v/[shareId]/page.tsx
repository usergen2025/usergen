import type { Metadata } from 'next';

const VIDEO_SERVICE_URL =
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';

async function loadShare(shareId: string): Promise<{ title: string; videoUrl: string } | null> {
  try {
    const response = await fetch(
      `${VIDEO_SERVICE_URL}/video-projects/shared/${encodeURIComponent(shareId)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return null;
    const body = await response.json();
    if (!body?.success || !body.data?.videoUrl) return null;
    return { title: body.data.title || 'UserGen video', videoUrl: body.data.videoUrl };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const share = await loadShare(shareId);
  const title = share?.title || 'UserGen video';
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3200').replace(/\/$/, '');
  const pageUrl = `${siteUrl}/v/${shareId}`;
  return {
    title,
    description: 'A video made with UserGen.',
    openGraph: {
      title,
      description: 'A video made with UserGen.',
      url: pageUrl,
      type: 'video.other',
      videos: share ? [{ url: `${siteUrl}${share.videoUrl}` }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: 'A video made with UserGen.',
    },
  };
}

export default async function SharedVideoPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const share = await loadShare(shareId);

  if (!share) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-center text-text-secondary">This video is not available.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-4 px-4 py-10">
      <h1 className="text-center text-xl font-semibold text-text-primary">{share.title}</h1>
      <video
        src={share.videoUrl}
        controls
        playsInline
        className="w-full rounded-xl bg-black"
      />
    </div>
  );
}
