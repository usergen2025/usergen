'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { fetchCampaignPreviewObjectUrl } from '@/lib/campaign-media';

interface CampaignWatermarkedPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  assetId: string | null;
  title?: string;
}

export function CampaignWatermarkedPreviewModal({
  isOpen,
  onClose,
  assetId,
  title = 'Draft preview',
}: CampaignWatermarkedPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!isOpen || !assetId) {
      setObjectUrl(null);
      setError(null);
      setLoading(false);
      setPlaying(false);
      setDuration(0);
      setCurrent(0);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void fetchCampaignPreviewObjectUrl(assetId, ac.signal)
      .then((url) => {
        setObjectUrl(url);
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Could not load preview');
      })
      .finally(() => setLoading(false));

    return () => {
      ac.abort();
    };
  }, [isOpen, assetId]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrent(v.currentTime);
    setDuration(v.duration || 0);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !objectUrl) return;
    if (v.paused) {
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [objectUrl]);

  const seekToRatio = useCallback((ratio: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = Math.max(0, Math.min(duration * ratio, duration));
  }, [duration]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const tryFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    void el.requestFullscreen?.().catch(() => {});
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-sm sm:max-w-md">
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="brand-page-section-title">{title}</h3>
          <button
            type="button"
            className="rounded-full p-2 text-[#616161] hover:bg-orange-50"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={containerRef}
          className="relative mx-auto aspect-[9/16] max-h-[70dvh] w-full overflow-hidden rounded-2xl bg-black"
          onContextMenu={(e) => e.preventDefault()}
        >
          {loading ? (
            <div className="flex h-full w-full items-center justify-center text-sm text-white/80">
              Loading secure preview…
            </div>
          ) : error ? (
            <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-red-200">
              {error}
            </div>
          ) : objectUrl ? (
            <video
              ref={videoRef}
              src={objectUrl}
              className="block h-full w-full object-contain"
              playsInline
              muted={muted}
              preload="metadata"
              controls={false}
              disablePictureInPicture
              onLoadedMetadata={onTimeUpdate}
              onTimeUpdate={onTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onClick={togglePlay}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-white/60">
              No preview
            </div>
          )}

          {!loading && !error && objectUrl ? (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={duration ? current / duration : 0}
                onChange={(e) => seekToRatio(Number(e.target.value))}
                className="mb-2 w-full accent-[#E86512]"
                aria-label="Seek"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
                    aria-label={playing ? 'Pause' : 'Play'}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                  >
                    {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMute();
                    }}
                  >
                    {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </button>
                  <span className="text-xs text-white/85 tabular-nums">
                    {formatClock(current)} / {formatClock(duration)}
                  </span>
                </div>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-xs text-white/90 hover:bg-white/15"
                  onClick={(e) => {
                    e.stopPropagation();
                    tryFullscreen();
                  }}
                >
                  Full screen
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-[0.7rem] text-text-secondary">
          Watermarked preview. Download and context menu are disabled to reduce casual leakage.
        </p>
      </div>
    </Modal>
  );
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
