'use client';

import { useState } from 'react';
import { Download, Play, Star, Clock, ExternalLink, ChevronLeft, X, Film, AlertCircle } from 'lucide-react';
import BrandPrimaryButton from '@/components/brand/BrandPrimaryButton';
import BrandSecondaryButton from '@/components/brand/BrandSecondaryButton';
import { cn } from '@/lib/utils/cn';

interface SsembleClip {
  id: string;
  ssembleClipId: string;
  title?: string | null;
  description?: string | null;
  videoUrl: string;
  thumbnailUrl?: string | null;
  durationSecs?: number | null;
  viralScore?: number | null;
}

interface ClipRequest {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  currentStep?: string | null;
  startSec: number;
  endSec: number;
  preferredLength: string;
  createdAt: string;
  errorMessage?: string | null;
  clips: SsembleClip[];
  sourceVideo?: {
    id: string;
    url: string;
    title?: string | null;
  };
}

interface SsembleClipsViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: ClipRequest | null;
}

export default function SsembleClipsViewerModal({
  isOpen,
  onClose,
  request,
}: SsembleClipsViewerModalProps) {
  const [selectedClip, setSelectedClip] = useState<SsembleClip | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDownload = async (clip: SsembleClip) => {
    setDownloading(clip.id);
    try {
      const response = await fetch(clip.videoUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clip.title || 'clip'}-${clip.ssembleClipId}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download failed:', err);
      window.open(clip.videoUrl, '_blank');
    } finally {
      setDownloading(null);
    }
  };

  const handleClose = () => {
    setSelectedClip(null);
    onClose();
  };

  if (!isOpen || !request) return null;

  // Helper to format viral score - API may return 0-1 or 0-100
  const formatViralScore = (score: number): number => {
    return score > 1 ? Math.round(score) : Math.round(score * 100);
  };

  const getStatusConfig = (status: ClipRequest['status']) => {
    switch (status) {
      case 'COMPLETED':
        return { color: 'bg-green-100 text-green-700', label: 'Completed' };
      case 'PROCESSING':
        return { color: 'bg-blue-100 text-blue-700', label: 'Processing' };
      case 'QUEUED':
        return { color: 'bg-yellow-100 text-yellow-700', label: 'Queued' };
      case 'FAILED':
        return { color: 'bg-red-100 text-red-700', label: 'Failed' };
      default:
        return { color: 'bg-gray-100 text-gray-700', label: status };
    }
  };

  const statusConfig = getStatusConfig(request.status);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        {selectedClip ? (
          <>
            {/* Clip Detail View */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
              <button
                onClick={() => setSelectedClip(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <h2 className="text-lg font-semibold text-[#212121] font-heading flex-1 truncate">
                {selectedClip.title || 'Generated Clip'}
              </h2>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Video Player */}
            <div className="flex-1 bg-black flex items-center justify-center min-h-0">
              <video
                src={selectedClip.videoUrl}
                controls
                autoPlay
                className="max-w-full max-h-[60vh]"
              />
            </div>

            {/* Clip Info & Actions */}
            <div className="px-5 py-4 border-t border-gray-100 bg-white">
              {selectedClip.description && (
                <p className="text-sm text-text-secondary mb-3">
                  {selectedClip.description}
                </p>
              )}
              <div className="flex items-center gap-4 text-sm text-text-secondary mb-4">
                {selectedClip.durationSecs && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    {formatDuration(selectedClip.durationSecs)}
                  </span>
                )}
                {selectedClip.viralScore !== null && selectedClip.viralScore !== undefined && (
                  <span className="flex items-center gap-1.5">
                    <Star className="w-4 h-4 text-yellow-500" />
                    Viral Score: {formatViralScore(selectedClip.viralScore)}%
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <BrandPrimaryButton
                  onClick={() => handleDownload(selectedClip)}
                  disabled={downloading === selectedClip.id}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {downloading === selectedClip.id ? 'Downloading...' : 'Download Clip'}
                </BrandPrimaryButton>
                <BrandSecondaryButton
                  onClick={() => window.open(selectedClip.videoUrl, '_blank')}
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open in New Tab
                </BrandSecondaryButton>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Fixed Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-[#E86512]" />
                <h2 className="text-lg font-semibold text-[#212121] font-heading">Generated Clips</h2>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Request Info */}
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-3 mb-2">
                <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', statusConfig.color)}>
                  {statusConfig.label}
                </span>
                <span className="text-xs text-text-secondary">
                  {formatDate(request.createdAt)}
                </span>
              </div>
              {request.sourceVideo && (
                <p className="text-sm text-[#212121] font-medium">
                  Source: {request.sourceVideo.title || 'Video'}
                </p>
              )}
              <p className="text-xs text-text-secondary mt-1">
                Segment: {formatDuration(request.startSec)} - {formatDuration(request.endSec)} | 
                Target: {request.preferredLength.replace('under', 'Under ').replace('sec', 's').replace('min', 'm')}
              </p>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Processing Progress */}
              {request.status === 'PROCESSING' && (
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-text-secondary">
                      {request.currentStep || 'Processing your video...'}
                    </span>
                    <span className="text-[#E86512] font-medium">{request.progress}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#E86512] rounded-full transition-all duration-300"
                      style={{ width: `${request.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error Message */}
              {request.status === 'FAILED' && request.errorMessage && (
                <div className="px-5 py-4">
                  <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-700">Generation Failed</p>
                      <p className="text-sm text-red-600 mt-1">{request.errorMessage}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Clips Grid */}
              {request.clips.length > 0 ? (
                <div className="p-5">
                  <h3 className="text-sm font-semibold text-[#212121] mb-4 font-heading">
                    {request.clips.length} Clip{request.clips.length !== 1 ? 's' : ''} Generated
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {request.clips.map((clip) => (
                      <div
                        key={clip.id}
                        className="border border-gray-200 rounded-xl overflow-hidden bg-white hover:shadow-md hover:border-[#E86512]/30 transition-all cursor-pointer"
                        onClick={() => setSelectedClip(clip)}
                      >
                        <div className="aspect-[9/16] relative bg-gray-100">
                          {clip.thumbnailUrl ? (
                            <img
                              src={clip.thumbnailUrl}
                              alt={clip.title || 'Clip thumbnail'}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <video
                              src={clip.videoUrl}
                              className="w-full h-full object-cover"
                              muted
                              preload="metadata"
                            />
                          )}
                          <div className="absolute inset-0 bg-black/20 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                              <Play className="w-6 h-6 text-[#E86512] ml-0.5" />
                            </div>
                          </div>
                          {clip.viralScore !== null && clip.viralScore !== undefined && (
                            <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Star className="w-3 h-3 text-yellow-400" />
                              {formatViralScore(clip.viralScore)}%
                            </div>
                          )}
                          {clip.durationSecs && (
                            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded">
                              {formatDuration(clip.durationSecs)}
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-medium text-[#212121] truncate">
                            {clip.title || 'Generated Clip'}
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(clip);
                            }}
                            disabled={downloading === clip.id}
                            className="mt-2 w-full text-sm text-[#E86512] hover:text-[#D85A10] flex items-center justify-center gap-1.5 py-1.5 border border-[#E86512]/30 rounded-lg hover:bg-orange-50 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            {downloading === clip.id ? 'Downloading...' : 'Download'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : request.status === 'COMPLETED' ? (
                <div className="p-8 text-center">
                  <Film className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-text-secondary">No clips were generated for this request.</p>
                </div>
              ) : null}
            </div>

            {/* Fixed Footer */}
            <div className="px-5 py-4 border-t border-gray-100 bg-white">
              <BrandSecondaryButton onClick={handleClose} fullWidth>
                Close
              </BrandSecondaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
