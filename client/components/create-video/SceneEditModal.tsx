'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';

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

export default function SceneEditModal({
  isOpen,
  onClose,
  sceneNumber,
  voiceover,
  prompt,
  promptLabel,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  sceneNumber: number;
  voiceover: string;
  prompt: string;
  promptLabel: string;
  onSave: (next: { voiceover: string; prompt: string; regenerate: boolean }) => Promise<void>;
}) {
  const [voiceoverText, setVoiceoverText] = useState(voiceover);
  const [promptText, setPromptText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setVoiceoverText(voiceover);
    setPromptText(sceneDescriptionFromPrompt(prompt));
  }, [isOpen, voiceover, prompt, sceneNumber]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  const save = async (regenerate: boolean) => {
    setSaving(true);
    try {
      await onSave({
        voiceover: voiceoverText,
        prompt: mergeSceneDescription(prompt, promptText),
        regenerate,
      });
      onClose();
    } finally {
      setSaving(false);
    }
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
                Update the spoken line and what this scene shows.
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
                rows={4}
                className="brand-field-capsule brand-field-capsule--textarea"
              />
            </label>
            <label className="block">
              <span className="brand-campaign-meta mb-1 block text-[#616161]">{promptLabel}</span>
              <textarea
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
                rows={4}
                className="brand-field-capsule brand-field-capsule--textarea"
              />
            </label>
          </div>

          <div className="shrink-0 space-y-2 border-t border-[#EFE8E3] p-3 sm:p-4">
            <div className="flex gap-2">
              <button type="button" className="brand-cta-secondary flex-1" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="brand-cta-secondary flex-1" onClick={() => save(false)} disabled={saving}>
                Save
              </button>
            </div>
            <button type="button" className="brand-cta-primary w-full" onClick={() => save(true)} disabled={saving}>
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </span>
              ) : (
                'Save and regenerate'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
