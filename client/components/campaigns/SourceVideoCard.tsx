'use client';

import { useState } from 'react';
import { Trash2, Edit2, Play, ExternalLink } from 'lucide-react';
import YouTubeEmbed from './YouTubeEmbed';

interface SourceVideo {
  id: string;
  url: string;
  urlType: 'YOUTUBE' | 'DIRECT';
  title?: string | null;
  thumbnailUrl?: string | null;
  durationSecs?: number | null;
  orderIndex: number;
}

interface SourceVideoCardProps {
  video: SourceVideo;
  onEdit?: (video: SourceVideo) => void;
  onDelete?: (videoId: string) => void;
  editable?: boolean;
  showActions?: boolean;
}

export default function SourceVideoCard({
  video,
  onEdit,
  onDelete,
  editable = false,
  showActions = true,
}: SourceVideoCardProps) {
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
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
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
                <span className="text-gray-400">No thumbnail</span>
              </div>
            )}
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                <Play className="w-8 h-8 text-primary-600 ml-1" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-text-primary text-sm truncate">
              {video.title || 'Untitled video'}
            </h4>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-text-secondary bg-gray-100 px-2 py-0.5 rounded">
                {video.urlType === 'YOUTUBE' ? 'YouTube' : 'Direct'}
              </span>
              {video.durationSecs && (
                <span className="text-xs text-text-secondary">
                  {formatDuration(video.durationSecs)}
                </span>
              )}
            </div>
          </div>

          {showActions && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleOpenExternal}
                className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              {editable && onEdit && (
                <button
                  onClick={() => onEdit(video)}
                  className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
              {editable && onDelete && (
                <button
                  onClick={() => onDelete(video.id)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
