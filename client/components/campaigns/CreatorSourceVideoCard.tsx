'use client';

import { useState } from 'react';
import { Play, Scissors, Eye, ExternalLink, Loader2 } from 'lucide-react';
import YouTubeEmbed from './YouTubeEmbed';
import { cn } from '@/lib/utils/cn';

interface SourceVideo {
  id: string;
  url: string;
  urlType: 'YOUTUBE' | 'DIRECT';
  title?: string | null;
  thumbnailUrl?: string | null;
  durationSecs?: number | null;
  orderIndex: number;
  clipRequestCount?: number;
}

interface CreatorSourceVideoCardProps {
  video: SourceVideo;
  onGenerateClips: (video: SourceVideo) => void;
  onViewClips: (video: SourceVideo) => void;
  hasActiveRequest?: boolean;
}

export default function CreatorSourceVideoCard({
  video,
  onGenerateClips,
  onViewClips,
  hasActiveRequest = false,
}: CreatorSourceVideoCardProps) {
  const [showPlayer, setShowPlayer] = useState(false);

  const handleOpenExternal = () => {
    window.open(video.url, '_blank', 'noopener,noreferrer');
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Video Player Area */}
      <div className="aspect-video relative bg-gray-100">
        {showPlayer ? (
          video.urlType === 'YOUTUBE' ? (
            <YouTubeEmbed url={video.url} className="w-full h-full" />
          ) : (
            <video
              src={video.url}
              controls
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <div
            className="w-full h-full flex items-center justify-center cursor-pointer group"
            onClick={() => setShowPlayer(true)}
          >
            {video.thumbnailUrl ? (
              <img
                src={video.thumbnailUrl}
                alt={video.title || 'Video thumbnail'}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                <Play className="w-8 h-8 text-gray-400" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                <Play className="w-6 h-6 text-[#E86512] ml-0.5" />
              </div>
            </div>
          </div>
        )}

        {/* Video Type Badge */}
        <div className="absolute top-2 left-2">
          <span className="text-xs bg-black/70 text-white px-2 py-0.5 rounded">
            {video.urlType === 'YOUTUBE' ? 'YouTube' : 'Video'}
          </span>
        </div>

        {/* Duration Badge */}
        {video.durationSecs && (
          <div className="absolute bottom-2 right-2">
            <span className="text-xs bg-black/70 text-white px-2 py-0.5 rounded">
              {formatDuration(video.durationSecs)}
            </span>
          </div>
        )}

        {/* Processing Indicator */}
        {hasActiveRequest && (
          <div className="absolute top-2 right-2">
            <span className="flex items-center gap-1 text-xs bg-[#E86512] text-white px-2 py-0.5 rounded">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </span>
          </div>
        )}
      </div>

      {/* Video Info & Actions */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="font-medium text-[#212121] text-sm truncate font-heading">
              {video.title || 'Source Video'}
            </h4>
            {video.clipRequestCount !== undefined && video.clipRequestCount > 0 && (
              <p className="text-xs text-text-secondary mt-0.5">
                {video.clipRequestCount} clip{video.clipRequestCount !== 1 ? 's' : ''} generated
              </p>
            )}
          </div>

          {/* Compact Icon Buttons */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Generate Clips Button */}
            <button
              onClick={() => onGenerateClips(video)}
              disabled={hasActiveRequest}
              className={cn(
                'p-2 rounded-full transition-all',
                hasActiveRequest
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-[#E86512] text-white hover:bg-[#D85A10] shadow-sm'
              )}
              title={hasActiveRequest ? 'Processing...' : 'Generate Clips'}
            >
              {hasActiveRequest ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Scissors className="w-4 h-4" />
              )}
            </button>

            {/* View Clips Button - Show only if clips exist */}
            {video.clipRequestCount !== undefined && video.clipRequestCount > 0 && (
              <button
                onClick={() => onViewClips(video)}
                className="p-2 rounded-full border border-[#E86512] text-[#E86512] hover:bg-orange-50 transition-colors"
                title="View Clips"
              >
                <Eye className="w-4 h-4" />
              </button>
            )}

            {/* External Link Button */}
            <button
              onClick={handleOpenExternal}
              className="p-2 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-[#E86512] hover:border-[#E86512] transition-colors"
              title="Open Original"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
