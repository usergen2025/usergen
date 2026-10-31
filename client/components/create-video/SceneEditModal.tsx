'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Upload, X } from 'lucide-react';

const META_TAG =
  /\[(?:Video topic|Style|Color palette|Lighting|Mood|Camera|Time|Tone|COMPOSITION|PRESENTATION|camera_motion|CRITICAL(?:\s+MOTION)?)[^\]]*\]/gi;

/**
 * The stored prompt is a stack of style tags plus one scene sentence.
 * The editor shows only that sentence.
 */
export function sceneDescriptionFromPrompt(prompt: string): string {
  const withoutMeta = prompt.replace(META_TAG, ' ');
  const prose = withoutMeta
    .replace(/\[Scene-specific:\s*/gi, ' ')
    .replace(/[\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,]+|[\s.,]+$/g, '')
    .trim();
  return prose || prompt.trim();
}

/** Put an edited sentence back into the scene slot and leave the style tags alone. */
export function mergeSceneDescription(original: string, description: string): string {
  const clean = description.trim();
  if (!clean) return original;
  if (!/\[(?:Scene-specific|Color palette|Lighting|Mood|Style|Video topic|COMPOSITION)/i.test(original)) {
    return clean;
  }
  if (/\[Scene-specific:\s*[^\[\]]+\]/i.test(original)) {
    return original.replace(/\[Scene-specific:\s*[^\[\]]+\]/i, `[Scene-specific: ${clean}]`);
  }
  return `${original.trim()} [Scene-specific: ${clean}]`;
}

export function applySceneTextEdit(
  script: unknown,
  sceneNumber: number,
  voiceover: string,
  prompt: string,
  promptField: 'broll_image_prompt' | 'broll_video_prompt',
): unknown {
  const parsed = typeof script === 'string' ? JSON.parse(script) : JSON.parse(JSON.stringify(script ?? {}));
  const scenes = parsed?.scenes || parsed?.scene_plan;
  if (!Array.isArray(scenes)) return parsed;
  const scene =
    scenes.find((item: any, index: number) => (item?.scene_number || item?.sceneNumber || index + 1) === sceneNumber) ||
    scenes[sceneNumber - 1];
  if (scene) {
    scene.voiceover = voiceover;
    const previous = typeof scene[promptField] === 'string' ? scene[promptField] : '';
    const incoming = prompt.trim();
    scene[promptField] = /\[Scene-specific:/i.test(incoming)
      ? incoming
      : mergeSceneDescription(previous, incoming);
  }
  return parsed;
}

export type SceneEditSavePayload = {
  voiceover: string;
  prompt: string;
  mediaFile: File | null;
  voiceoverChanged: boolean;
  promptChanged: boolean;
  mediaChanged: boolean;
  /** Only set when media changed and prompt text was left unchanged */
  rewritePromptFromMedia: boolean;
};

export default function SceneEditModal({
  isOpen,
  onClose,
  sceneNumber,
  voiceover,
  prompt,
  promptLabel,
  currentMediaUrl,
  /** images = image only; videos = image or video; none = hide media */
  mediaAccept = 'images',
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  sceneNumber: number;
  voiceover: string;
  prompt: string;
  promptLabel: string;
  currentMediaUrl?: string | null;
  mediaAccept?: 'images' | 'videos' | 'none';
  onSave: (next: SceneEditSavePayload) => Promise<void>;
}) {
  const [voiceoverText, setVoiceoverText] = useState(voiceover);
  const [promptText, setPromptText] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialPromptSentence = useRef('');

  useEffect(() => {
    if (!isOpen) return;
    setVoiceoverText(voiceover);
    const sentence = sceneDescriptionFromPrompt(prompt);
    setPromptText(sentence);
    initialPromptSentence.current = sentence;
    setMediaFile(null);
    setMediaPreviewUrl(null);
    setConfirmOpen(false);
    setError(null);
    setSaving(false);
  }, [isOpen, voiceover, prompt, sceneNumber]);

  useEffect(() => {
    return () => {
      if (mediaPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(mediaPreviewUrl);
    };
  }, [mediaPreviewUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (confirmOpen) setConfirmOpen(false);
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose, confirmOpen]);

  const voiceoverChanged = voiceoverText.trim() !== (voiceover || '').trim();
  const promptChanged = promptText.trim() !== initialPromptSentence.current.trim();
  const mediaChanged = !!mediaFile;
  const isDirty = voiceoverChanged || promptChanged || mediaChanged;

  const acceptAttr = useMemo(() => {
    if (mediaAccept === 'videos') return 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
    if (mediaAccept === 'images') return 'image/jpeg,image/png,image/webp';
    return undefined;
  }, [mediaAccept]);

  const displayMediaUrl = mediaPreviewUrl || currentMediaUrl || null;
  const isVideoPreview =
    mediaFile?.type.startsWith('video/') ||
    (!!displayMediaUrl && /\.(mp4|mov|webm)(\?|$)/i.test(displayMediaUrl));

  const onPickFile = (file: File | null) => {
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (mediaAccept === 'images' && !isImage) {
      setError('Please choose an image file (JPG, PNG, or WebP).');
      return;
    }
    if (mediaAccept === 'videos' && !isImage && !isVideo) {
      setError('Please choose an image or video file.');
      return;
    }
    setError(null);
    if (mediaPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaFile(file);
    setMediaPreviewUrl(URL.createObjectURL(file));
  };

  const commit = async (rewritePromptFromMedia: boolean) => {
    if (!voiceoverText.trim()) {
      setError('Voiceover cannot be empty.');
      return;
    }
    if (!promptText.trim()) {
      setError('Prompt cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        voiceover: voiceoverText,
        prompt: mergeSceneDescription(prompt, promptText),
        mediaFile,
        voiceoverChanged,
        promptChanged,
        mediaChanged,
        rewritePromptFromMedia,
      });
      onClose();
    } catch {
      // Parent shows toast; keep modal open for retry
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  const onSaveAndRegenerate = () => {
    if (!isDirty || saving) return;
    if (mediaChanged && !promptChanged) {
      setConfirmOpen(true);
      return;
    }
    void commit(false);
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center gradient-overlay p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="brand-gradient-frame flex max-h-[92dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[20px] p-2.5 sm:rounded-[20px] sm:p-3"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-edit-title"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-white shadow-sm">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#EFE8E3] p-3 sm:p-4">
            <div className="min-w-0">
              <h3 id="scene-edit-title" className="brand-campaign-page-title">
                Edit scene {sceneNumber}
              </h3>
              <p className="brand-campaign-meta mt-0.5 text-[#616161]">
                Update the spoken line, prompt, and media for this scene.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white text-[#212121] transition-colors hover:bg-orange-50/60"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
            <label className="block">
              <span className="brand-campaign-meta mb-1 block text-[#616161]">Voiceover</span>
              <textarea
                value={voiceoverText}
                onChange={(event) => setVoiceoverText(event.target.value)}
                rows={2}
                className="brand-field-capsule brand-field-capsule--textarea"
              />
            </label>
            <label className="block">
              <span className="brand-campaign-meta mb-1 block text-[#616161]">{promptLabel}</span>
              <textarea
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
                rows={2}
                className="brand-field-capsule brand-field-capsule--textarea"
              />
            </label>

            {mediaAccept !== 'none' && (
              <div>
                <span className="brand-campaign-meta mb-1 block text-[#616161]">Media</span>
                <div className="flex items-center gap-3 rounded-[14px] border border-[#E8E2DB] bg-[#FAF8F6] p-3">
                  <div className="h-[72px] w-14 shrink-0 overflow-hidden rounded-[10px] bg-[#E8E2DB]">
                    {displayMediaUrl ? (
                      isVideoPreview ? (
                        <video src={displayMediaUrl} className="h-full w-full object-cover" muted playsInline />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={displayMediaUrl} alt="" className="h-full w-full object-cover" />
                      )
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#212121]">
                      {mediaFile ? mediaFile.name : displayMediaUrl ? 'Current media' : 'No media yet'}
                    </p>
                    <p className="text-xs text-[#616161]">
                      {mediaAccept === 'videos' ? 'Upload an image or video from your device' : 'Upload an image from your device'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="brand-cta-secondary shrink-0 !px-3 !py-2 text-sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Upload className="h-3.5 w-3.5" />
                      Replace
                    </span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={acceptAttr}
                    className="hidden"
                    onChange={(event) => onPickFile(event.target.files?.[0] || null)}
                  />
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <div className="shrink-0 border-t border-[#EFE8E3] p-3 sm:p-4">
            <div className="flex gap-2">
              <button type="button" className="brand-cta-secondary flex-1" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="brand-cta-primary flex-1 disabled:opacity-50 disabled:pointer-events-none"
                onClick={onSaveAndRegenerate}
                disabled={saving || !isDirty}
              >
                {saving ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </span>
                ) : (
                  'Save and regenerate'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <div
          className="absolute inset-0 z-[210] flex items-end justify-center p-0 sm:items-center sm:p-4"
          onClick={(event) => {
            event.stopPropagation();
            if (!saving) setConfirmOpen(false);
          }}
          role="presentation"
        >
          <div
            className="brand-gradient-frame w-full max-w-[420px] rounded-t-[20px] p-2.5 sm:rounded-[20px] sm:p-3"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scene-prompt-confirm-title"
          >
            <div className="rounded-[16px] bg-white p-4 shadow-sm sm:p-5">
              <h3 id="scene-prompt-confirm-title" className="brand-campaign-page-title">
                Prompt still the same
              </h3>
              <p className="brand-campaign-meta mt-2 text-[#616161]">
                You added new media but did not change the {promptLabel.toLowerCase()}. Keep the current prompt, or let
                us rewrite it to match this media?
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="brand-cta-secondary flex-1"
                  disabled={saving}
                  onClick={() => void commit(false)}
                >
                  Keep current
                </button>
                <button
                  type="button"
                  className="brand-cta-primary flex-1"
                  disabled={saving}
                  onClick={() => void commit(true)}
                >
                  {saving ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Working…
                    </span>
                  ) : (
                    'Rewrite for best result'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
