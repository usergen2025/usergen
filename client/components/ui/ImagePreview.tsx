'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface ImagePreviewProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  alt?: string;
}

export default function ImagePreview({ imageUrl, isOpen, onClose, alt = 'Preview' }: ImagePreviewProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative max-w-7xl max-h-[90dvh] w-full h-full flex items-center justify-center p-4">
        <button
          onClick={onClose}
          className={cn(
            'absolute top-4 right-4 z-10',
            'p-2 rounded-full bg-background/90 hover:bg-background',
            'text-text-primary hover:text-text-secondary',
            'transition-colors duration-200',
            'border border-border'
          )}
          aria-label="Close preview"
        >
          <X className="w-6 h-6" />
        </button>
        
        <img
          src={imageUrl}
          alt={alt}
          className="max-w-full max-h-full object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
          onError={(e) => {
            console.error('Preview image failed to load:', imageUrl);
            const target = e.target as HTMLImageElement;
            // Show error message instead of placeholder
            target.style.display = 'none';
          }}
        />
      </div>
    </div>
  );
}

