'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Languages, Plus, RefreshCw, Search, X } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useWebSocketContext, JobStatusUpdate } from '@/contexts/WebSocketContext';
import { cn } from '@/lib/utils/cn';

export interface VideoTranslationVariant {
  id: string;
  language: string;
  status: string;
  progress: number;
  jobId?: string;
  videoUrl?: string;
  localVideoUrl?: string;
  previewVideoUrl?: string;
  error?: string;
  completedAt?: string;
}

const IN_FLIGHT_STATUSES = ['pending', 'translating_scenes', 'stitching', 'post_processing'];

function isTranslating(status: string): boolean {
  return IN_FLIGHT_STATUSES.includes(status);
}

function statusLabel(v: VideoTranslationVariant): string {
  if (v.status === 'completed') return 'Ready';
  if (v.status === 'failed') return v.error || 'Failed';
  if (isTranslating(v.status)) return `${v.progress || 0}%`;
  return v.status;
}

function resolveMediaUrl(url: string | undefined | null, base?: string): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  if (base) {
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${base.replace(/\/$/, '')}${path}`;
  }
  return url;
}

function variantPlaybackUrl(v: VideoTranslationVariant, base?: string): string | null {
  return resolveMediaUrl(v.previewVideoUrl, base) ?? resolveMediaUrl(v.videoUrl, base);
}

interface VideoTranslationsPanelProps {
  projectId: string;
  originalLanguageLabel?: string;
  originalVideoUrl?: string | null;
  initialTranslations?: VideoTranslationVariant[];
  onPlaybackUrlChange?: (url: string | null, variantId: 'original' | string) => void;
  modalOpen?: boolean;
  onModalOpenChange?: (open: boolean) => void;
  layout?: 'chips' | 'sidebar';
  onSelectItem?: () => void;
  videoServiceBase?: string;
}

export function VideoTranslationsPanel({
  projectId,
  originalLanguageLabel = 'Original',
  originalVideoUrl,
  initialTranslations = [],
  onPlaybackUrlChange,
  modalOpen,
  onModalOpenChange,
  layout = 'sidebar',
  onSelectItem,
  videoServiceBase,
}: VideoTranslationsPanelProps) {
  const { showToast } = useToast();
  const { subscribeToJob } = useWebSocketContext();
  const [translations, setTranslations] = useState<VideoTranslationVariant[]>(initialTranslations);
  const [languages, setLanguages] = useState<string[]>([]);
  const [selected, setSelected] = useState<'original' | string>('original');
  const [internalOpen, setInternalOpen] = useState(false);
  const showModal = modalOpen ?? internalOpen;
  const setShowModal = onModalOpenChange ?? setInternalOpen;
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingLangs, setLoadingLangs] = useState(false);
  const [creditCostPerLanguage, setCreditCostPerLanguage] = useState<number | null>(null);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setPicked([]);
    setQuery('');
  }, [setShowModal]);

  const openModal = useCallback(() => {
    setShowModal(true);
  }, [setShowModal]);

  useEffect(() => {
    setTranslations(initialTranslations);
  }, [initialTranslations]);

  const refresh = useCallback(async () => {
    const res = await apiClient.getVideoTranslations(projectId);
    if (res.success && res.data?.translations) {
      setTranslations(res.data.translations);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!showModal) return;
    if (!languages.length) {
      setLoadingLangs(true);
      apiClient
        .getTranslationLanguages()
        .then((res) => {
          if (res.success && res.data?.languages) setLanguages(res.data.languages);
        })
        .catch(() => showToast('Failed to load languages', 'error'))
        .finally(() => setLoadingLangs(false));
    }
    if (creditCostPerLanguage == null) {
      apiClient
        .getOperationCreditCost('VIDEO_TRANSLATION')
        .then((res) => {
          if (res.success && typeof res.data?.creditCost === 'number') {
            setCreditCostPerLanguage(res.data.creditCost);
          }
        })
        .catch(() => setCreditCostPerLanguage(50));
    }
  }, [showModal, languages.length, creditCostPerLanguage, showToast]);

  const availableLanguages = useMemo(() => {
    const used = new Set(
      translations
        .filter((t) => t.status === 'completed' || IN_FLIGHT_STATUSES.includes(t.status))
        .map((t) => t.language),
    );
    return languages.filter((l) => !used.has(l));
  }, [languages, translations]);

  const filteredLanguages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableLanguages;
    return availableLanguages.filter((l) => l.toLowerCase().includes(q));
  }, [availableLanguages, query]);

  const handleJobUpdate = useCallback((update: JobStatusUpdate) => {
    const variantId = update.metadata?.variantId || update.result?.variantId;
    if (!variantId) return;

    setTranslations((prev) =>
      prev.map((v) => {
        if (v.id !== variantId) return v;
        if (update.state === 'completed' && update.result?.video) {
          return {
            ...v,
            ...update.result.video,
            status: 'completed',
            progress: 100,
          };
        }
        if (update.state === 'failed') {
          return { ...v, status: 'failed', error: update.error || v.error };
        }
        return {
          ...v,
          progress: update.progress ?? v.progress,
          status:
            update.state === 'active' || update.state === 'processing'
              ? 'translating_scenes'
              : v.status,
        };
      }),
    );
  }, []);

  const subscribeJobs = useCallback(
    (jobs: { variantId: string; jobId: string }[]) => {
      jobs.forEach(({ jobId }) => {
        subscribeToJob(jobId, 'video-translation', handleJobUpdate);
      });
    },
    [subscribeToJob, handleJobUpdate],
  );

  useEffect(() => {
    const pending = translations.filter(
      (t) => t.jobId && IN_FLIGHT_STATUSES.includes(t.status),
    );
    pending.forEach((t) => {
      if (t.jobId) subscribeToJob(t.jobId, 'video-translation', handleJobUpdate);
    });
  }, [translations, subscribeToJob, handleJobUpdate]);

  const estimatedCost = (creditCostPerLanguage ?? 50) * picked.length;

  const handleCreate = async () => {
    if (!picked.length) return;
    setLoading(true);
    try {
      const res = await apiClient.createVideoTranslations(projectId, picked);
      if (!res.success) throw new Error(res.message || 'Failed to start translation');
      if (res.data?.variants) setTranslations(res.data.variants);
      if (res.data?.jobs?.length) subscribeJobs(res.data.jobs);
      closeModal();
      showToast('Translation started', 'success');
      void refresh();
    } catch (e: any) {
      showToast(e?.message || 'Translation failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (variantId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    try {
      await apiClient.deleteVideoTranslation(projectId, variantId);
      setTranslations((prev) => prev.filter((v) => v.id !== variantId));
      if (selected === variantId) {
        setSelected('original');
        onPlaybackUrlChange?.(null, 'original');
      }
      showToast('Translation removed', 'info');
    } catch (err: any) {
      showToast(err?.message || 'Delete failed', 'error');
    }
  };

  const handleRetry = async (language: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const res = await apiClient.createVideoTranslations(projectId, [language]);
      if (res.data?.jobs?.length) subscribeJobs(res.data.jobs);
      if (res.data?.variants) setTranslations(res.data.variants);
      showToast('Retry started', 'success');
      void refresh();
    } catch (err: any) {
      showToast(err?.message || 'Retry failed', 'error');
    }
  };

  const selectVariant = (id: 'original' | string, url?: string | null) => {
    setSelected(id);
    onPlaybackUrlChange?.(url ?? null, id);
    onSelectItem?.();
  };

  const togglePicked = (lang: string) => {
    setPicked((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  };

  const renderSidebarList = () => (
    <div className="flex flex-col items-stretch gap-1.5 w-full">
      <button
        type="button"
        onClick={() => selectVariant('original', null)}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors',
          selected === 'original'
            ? 'border-[#E86412] bg-[#E86412]/5'
            : 'border-[#E8E0DA] bg-white hover:border-[#E86412]/40',
        )}
      >
        <Languages className="w-4 h-4 text-[#E86412] shrink-0" />
        <span className="flex-1 min-w-0 font-heading text-sm text-[#212121] truncate">
          {originalLanguageLabel}
        </span>
        <span className="text-[11px] text-[#616161] shrink-0">Source</span>
      </button>

      {translations.map((v) => {
        const translating = isTranslating(v.status);
        const failed = v.status === 'failed';
        const ready = v.status === 'completed' && Boolean(v.videoUrl);
        const isSelected = selected === v.id;

        return (
          <div
            key={v.id}
            className={cn(
              'w-full flex items-center gap-1 rounded-lg border transition-colors',
              isSelected && ready
                ? 'border-[#E86412] bg-[#E86412]/5'
                : failed
                  ? 'border-red-200 bg-red-50/50'
                  : translating
                    ? 'border-amber-200 bg-amber-50/50'
                    : 'border-[#E8E0DA] bg-white',
            )}
          >
            <button
              type="button"
              disabled={!ready}
              onClick={() => ready && selectVariant(v.id, variantPlaybackUrl(v, videoServiceBase))}
              className={cn(
                'flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 text-left rounded-lg',
                ready ? 'cursor-pointer hover:opacity-90' : 'cursor-default',
              )}
            >
              {translating ? (
                <Loader2 className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
              ) : failed ? (
                <span className="w-4 h-4 text-red-500 text-center shrink-0">!</span>
              ) : (
                <Languages className="w-4 h-4 text-[#E86412] shrink-0" />
              )}
              <span className="flex-1 min-w-0 font-heading text-sm text-[#212121] truncate">
                {v.language}
              </span>
              <span
                className={cn(
                  'text-[11px] shrink-0 tabular-nums',
                  failed ? 'text-red-600' : translating ? 'text-amber-700' : 'text-[#616161]',
                )}
              >
                {statusLabel(v)}
              </span>
            </button>
            {failed && (
              <button
                type="button"
                title="Retry translation"
                onClick={(e) => void handleRetry(v.language, e)}
                className="p-1.5 mr-0.5 rounded-full text-[#8B6C5C] hover:text-[#E86412] transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              title="Remove translation"
              onClick={(e) => void handleDelete(v.id, e)}
              className="p-1.5 mr-1.5 rounded-full text-[#8B6C5C] hover:text-red-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      {translations.length === 0 && (
        <p className="text-xs text-[#616161] leading-snug px-1 py-2 text-center">
          No translations yet. Use Translate to add a language version.
        </p>
      )}
    </div>
  );

  const renderChipsList = () => (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => selectVariant('original', null)}
        className={cn(
          'group relative px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
          selected === 'original'
            ? 'bg-[#E86412] text-white border-[#E86412]'
            : 'bg-white text-gray-700 border-gray-200 hover:border-[#E86412]',
        )}
      >
        {originalLanguageLabel}
      </button>

      {translations.map((v) => {
        const translating = isTranslating(v.status);
        const failed = v.status === 'failed';
        const ready = v.status === 'completed' && Boolean(v.videoUrl);

        return (
          <div
            key={v.id}
            className={cn(
              'group relative flex items-center gap-0.5 rounded-full border transition-colors',
              selected === v.id && ready
                ? 'bg-[#E86412] border-[#E86412]'
                : failed
                  ? 'bg-red-50 border-red-200'
                  : translating
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-white border-gray-200',
            )}
          >
            <button
              type="button"
              disabled={!ready}
              onClick={() => ready && selectVariant(v.id, variantPlaybackUrl(v, videoServiceBase))}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 pr-1',
                selected === v.id && ready
                  ? 'text-white'
                  : failed
                    ? 'text-red-800'
                    : translating
                      ? 'text-amber-900'
                      : 'text-gray-700',
                !ready && !translating && !failed && 'opacity-60 cursor-not-allowed',
              )}
            >
              {translating && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
              {failed && <span className="text-red-600 shrink-0">⚠</span>}
              <span className="truncate max-w-[140px] sm:max-w-[180px]">{v.language}</span>
              {translating && <span className="tabular-nums shrink-0">{v.progress || 0}%</span>}
            </button>

            {failed && (
              <button
                type="button"
                title="Retry translation"
                onClick={(e) => void handleRetry(v.language, e)}
                className="p-1 mr-0.5 rounded-full hover:bg-red-100 text-red-700"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}

            <button
              type="button"
              title="Remove translation"
              onClick={(e) => void handleDelete(v.id, e)}
              className={cn(
                'p-1 mr-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity',
                selected === v.id && ready
                  ? 'hover:bg-white/20 text-white'
                  : 'hover:bg-gray-100 text-gray-500 hover:text-red-600',
              )}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {layout === 'sidebar' ? (
        <div className="flex flex-col h-full w-full min-h-0">
          <div className="flex items-center justify-between gap-2 w-full shrink-0 mb-[clamp(8px,0.98vh,10px)]">
            <h3 className="font-heading font-medium text-[clamp(14px,1.56vh,16px)] text-[#212121] flex items-center gap-2">
              <Languages className="w-4 h-4 text-[#E86412]" />
              Languages
            </h3>
            <button
              type="button"
              onClick={openModal}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#E86412] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 pr-[clamp(4px,0.52vw,8px)]">{renderSidebarList()}</div>
        </div>
      ) : (
        <div className="w-full max-w-lg mt-2 space-y-2">{renderChipsList()}</div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full flex flex-col max-h-[min(85vh,640px)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
              <div>
                <h4 className="font-heading font-semibold text-lg text-[#212121] flex items-center gap-2">
                  <Languages className="w-5 h-5 text-[#E86412]" />
                  Translate video
                </h4>
                <p className="text-xs text-gray-500 mt-1 max-w-sm">
                  Lip-sync on avatar scenes; narration-only on b-roll. Branding and captions are re-applied.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500 shrink-0"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search languages…"
                  className="w-full pl-9 pr-3 py-2.5 rounded-full border border-gray-200 text-sm text-[#212121] placeholder:text-gray-400 focus:outline-none focus:border-[#E86412] focus:ring-1 focus:ring-[#E86412]/30"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
              {loadingLangs ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-7 h-7 animate-spin text-[#E86412]" />
                </div>
              ) : filteredLanguages.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  {availableLanguages.length === 0
                    ? 'No additional languages available for this project.'
                    : `No languages match "${query.trim()}".`}
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {filteredLanguages.map((lang) => {
                    const active = picked.includes(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => togglePicked(lang)}
                        className={cn(
                          'px-3 py-2.5 rounded-xl text-sm text-left border transition-colors font-medium',
                          active
                            ? 'border-[#E86412] bg-[#E86412]/5 text-[#212121]'
                            : 'border-gray-200 text-gray-700 hover:border-[#E86412]/50 hover:bg-gray-50',
                        )}
                      >
                        <span className="line-clamp-2">{lang}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/80 shrink-0 space-y-3">
              {picked.length > 0 ? (
                <p className="text-sm text-gray-700">
                  Estimated cost:{' '}
                  <span className="font-semibold text-[#212121]">{estimatedCost} credits</span>
                  {picked.length > 1 ? (
                    <span className="text-gray-500">
                      {' '}
                      ({creditCostPerLanguage ?? 50} × {picked.length} languages)
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="text-sm text-gray-500">Select one or more languages to translate.</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-4 py-2.5 text-sm font-medium rounded-full border border-gray-200 text-gray-700 hover:bg-white"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={loading || !picked.length}
                  onClick={() => void handleCreate()}
                  className="px-5 py-2.5 text-sm font-semibold rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity min-w-[120px]"
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Starting…
                    </span>
                  ) : (
                    `Translate${picked.length ? ` (${picked.length})` : ''}`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
