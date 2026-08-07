'use client';

import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useToast } from '@/lib/toast/toast';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
/** Guard on the file the user picks, before we downscale it. */
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
/** Longest edge we keep — a brand logo never renders larger than this in-app. */
const MAX_EDGE_PX = 192;
/** Ceiling on the encoded string, since it travels inline with the signup call. */
const MAX_ENCODED_BYTES = 120 * 1024;

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file is not a readable image'));
    image.src = src;
  });
}

/**
 * Signup happens before the user has a token, so there is no authenticated
 * upload target yet. We downscale the logo in the browser and hand it to
 * `verifyOtp` as a data URL, which the `brandLogo` text column already accepts.
 */
async function toStoredLogo(file: File): Promise<string> {
  const sourceDataUrl = await readAsDataUrl(file);

  // SVGs are already tiny and resolution-independent; rasterising would only
  // throw away quality.
  if (file.type === 'image/svg+xml') return sourceDataUrl;

  const image = await loadImage(sourceDataUrl);
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longestEdge) throw new Error('That file is not a readable image');

  const scale = Math.min(1, MAX_EDGE_PX / longestEdge);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not process that image');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

export default function BrandLogoPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
}) {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;

      if (!ACCEPTED_TYPES.includes(file.type)) {
        showToast('Logo must be a PNG, JPG, WEBP or SVG', 'error');
        return;
      }
      if (file.size > MAX_SOURCE_BYTES) {
        showToast('Logo must be under 6 MB', 'error');
        return;
      }

      setIsProcessing(true);
      try {
        const stored = await toStoredLogo(file);
        if (stored.length > MAX_ENCODED_BYTES) {
          showToast('That logo is too detailed — try a simpler or smaller image', 'error');
          return;
        }
        setFileName(file.name);
        onChange(stored);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not read that file', 'error');
      } finally {
        setIsProcessing(false);
      }
    },
    [onChange, showToast],
  );

  const clear = () => {
    setFileName('');
    onChange('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="brand-field-shell brand-field-shell--action auth-field">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="sr-only"
        disabled={disabled || isProcessing}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {value ? (
        <>
          {/* Data URL of unknown origin — next/image cannot optimise it */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full border border-[#E8E2DB] bg-white object-contain"
          />
          <span className="min-w-0 flex-1 truncate font-heading text-[15px] text-[#212121]">
            {fileName || 'Logo attached'}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            aria-label="Remove logo"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white text-[#212121] transition-colors hover:bg-orange-50/60 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate font-heading text-[15px] text-[#9E9E9E]">
            {isProcessing ? 'Preparing logo…' : 'Attach a logo'}
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || isProcessing}
            aria-label="Choose a logo file"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        </>
      )}
    </div>
  );
}
