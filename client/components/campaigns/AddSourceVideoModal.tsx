'use client';

import { useState } from 'react';
import { Link, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import BrandPrimaryButton from '@/components/brand/BrandPrimaryButton';
import BrandSecondaryButton from '@/components/brand/BrandSecondaryButton';

interface AddSourceVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (url: string, title?: string) => void | Promise<void>;
}

export default function AddSourceVideoModal({
  isOpen,
  onClose,
  onAdd,
}: AddSourceVideoModalProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateUrl = (value: string): boolean => {
    if (!value.trim()) {
      setError('Please enter a video URL');
      return false;
    }

    const isYouTube =
      value.includes('youtube.com') || value.includes('youtu.be');
    const isDirectVideo = /\.(mp4|mov|webm|avi|mkv)(\?|$)/i.test(value);
    const isValidUrl =
      value.startsWith('http://') || value.startsWith('https://');

    if (!isYouTube && !isDirectVideo && !isValidUrl) {
      setError('Please enter a valid YouTube URL or direct video link');
      return false;
    }

    setError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateUrl(url)) return;

    setIsSubmitting(true);
    try {
      await onAdd(url.trim(), title.trim() || undefined);
      setUrl('');
      setTitle('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to add video');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setTitle('');
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Source Video"
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            Video URL <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) validateUrl(e.target.value);
              }}
              placeholder="https://youtube.com/watch?v=... or direct video link"
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            />
          </div>
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
          <p className="mt-1 text-xs text-text-secondary">
            Supports YouTube URLs and direct video links (MP4, MOV, WebM)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            Title (optional)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a descriptive title"
            maxLength={200}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <BrandSecondaryButton
            type="button"
            onClick={handleClose}
            className="flex-1"
          >
            Cancel
          </BrandSecondaryButton>
          <BrandPrimaryButton
            type="submit"
            disabled={isSubmitting || !url.trim()}
            className="flex-1"
          >
            {isSubmitting ? 'Adding...' : 'Add Video'}
          </BrandPrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
