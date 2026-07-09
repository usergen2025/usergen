'use client';

interface YouTubeEmbedProps {
  url: string;
  className?: string;
  autoplay?: boolean;
}

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube\.com\/shorts\/([^?&]+)/,
    /youtube\.com\/v\/([^?&]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export default function YouTubeEmbed({
  url,
  className = '',
  autoplay = false,
}: YouTubeEmbedProps) {
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    return (
      <div className={`bg-gray-100 rounded-lg flex items-center justify-center text-gray-500 ${className}`}>
        Invalid YouTube URL
      </div>
    );
  }

  const embedUrl = `https://www.youtube.com/embed/${videoId}${autoplay ? '?autoplay=1' : ''}`;

  return (
    <iframe
      className={`w-full aspect-video rounded-lg ${className}`}
      src={embedUrl}
      title="YouTube video player"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}
