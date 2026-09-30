'use client';

import { useState } from 'react';
import { Facebook, Instagram, Share2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';

const SHARE_TEXT = 'Check out my video created with UserGen';

/**
 * Share always opens the system share sheet. Facebook opens Facebook's share
 * window. Instagram saves the file on a computer, because Instagram has no
 * web share, and uses the system sheet on a phone.
 */
export default function ShareActions({
  projectId,
  variant = 'workspace',
}: {
  projectId: string;
  variant?: 'workspace' | 'preview';
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const publicPageUrl = async () => {
    const link = await apiClient.createShareLink(projectId);
    if (!link.success || !link.data?.path || !link.data.shareId) {
      throw new Error(link.message || 'Could not prepare the video');
    }
    return {
      url: `${window.location.origin}${link.data.path}`,
      shareId: link.data.shareId,
    };
  };

  const videoFile = async (shareId: string) => {
    const response = await fetch(`/api/video/shared/${shareId}/video?disposition=attachment`);
    if (!response.ok) throw new Error('Could not load the video file');
    const blob = await response.blob();
    return new File([blob], 'usergen-video.mp4', { type: blob.type || 'video/mp4' });
  };

  const downloadFile = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  const onPhone = () =>
    typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;

  const shareFileOnPhone = async () => {
    const { shareId } = await publicPageUrl();
    const file = await videoFile(shareId);
    const payload = { files: [file], text: SHARE_TEXT, title: 'My UserGen video' };
    if (!navigator.canShare?.(payload)) return false;
    try {
      await navigator.share(payload);
    } catch (error: any) {
      if (error?.name === 'AbortError') return true;
      return false;
    }
    return true;
  };

  const openFacebook = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { url } = await publicPageUrl();
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        '_blank',
        'noopener,noreferrer',
      );
    } catch (error: any) {
      showToast(error?.message || 'Could not open Facebook', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openInstagram = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (onPhone() && (await shareFileOnPhone())) return;
      const { shareId } = await publicPageUrl();
      downloadFile(await videoFile(shareId));
      showToast('Saved the video. Upload it in Instagram — their site cannot take a file from here.', 'info');
    } catch (error: any) {
      showToast(error?.message || 'Could not prepare the video for Instagram', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onShareClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { url, shareId } = await publicPageUrl();
      if (typeof navigator.share === 'function') {
        const file = await videoFile(shareId);
        const withFile = { files: [file], text: SHARE_TEXT, title: 'My UserGen video' };
        if (navigator.canShare?.(withFile)) {
          await navigator.share(withFile);
          return;
        }
        await navigator.share({ title: 'My UserGen video', text: SHARE_TEXT, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('Link copied', 'success');
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      showToast(error?.message || 'Could not share this video', 'error');
    } finally {
      setBusy(false);
    }
  };

  const itemClass =
    variant === 'workspace'
      ? 'flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px] disabled:opacity-50 disabled:cursor-not-allowed'
      : 'flex flex-col items-center gap-2 p-3 border border-border rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const labelClass = variant === 'workspace' ? 'text-xs text-gray-600' : 'text-xs';
  const iconClass = variant === 'workspace' ? 'w-6 h-6 text-[#E86412]' : 'w-6 h-6';

  return (
    <>
      <button type="button" className={itemClass} disabled={busy} onClick={() => void openInstagram()}>
        <InstagramMark className={iconClass} filled={variant === 'workspace'} />
        <span className={labelClass}>Instagram</span>
      </button>
      <button type="button" className={itemClass} disabled={busy} onClick={() => void openFacebook()}>
        <FacebookMark className={iconClass} filled={variant === 'workspace'} />
        <span className={labelClass}>Facebook</span>
      </button>
      <button type="button" className={itemClass} disabled={busy} onClick={() => void onShareClick()}>
        <ShareMark className={iconClass} stroke={variant === 'workspace'} />
        <span className={labelClass}>Share</span>
      </button>
    </>
  );
}

function InstagramMark({ className, filled }: { className: string; filled: boolean }) {
  if (!filled) return <Instagram className={className} />;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zM12 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function FacebookMark({ className, filled }: { className: string; filled: boolean }) {
  if (!filled) return <Facebook className={className} />;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function ShareMark({ className, stroke }: { className: string; stroke: boolean }) {
  if (!stroke) return <Share2 className={className} />;
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"
      />
    </svg>
  );
}
