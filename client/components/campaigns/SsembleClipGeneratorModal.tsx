'use client';

import { useState, useEffect, useRef } from 'react';
import { Scissors, Clock, Globe, Music, Sparkles, Gamepad2, MessageSquare, ChevronDown, X } from 'lucide-react';
import BrandPrimaryButton from '@/components/brand/BrandPrimaryButton';
import BrandSecondaryButton from '@/components/brand/BrandSecondaryButton';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import YouTubeEmbed from './YouTubeEmbed';

interface SourceVideo {
  id: string;
  url: string;
  urlType: 'YOUTUBE' | 'DIRECT';
  title?: string | null;
  durationSecs?: number | null;
}

interface SsembleClipGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceVideo: SourceVideo | null;
  campaignId: string;
  onGenerate: (data: any) => Promise<void>;
}

const PREFERRED_LENGTH_OPTIONS = [
  { value: 'under30sec', label: 'Under 30 seconds' },
  { value: 'under60sec', label: 'Under 60 seconds' },
  { value: 'under90sec', label: 'Under 90 seconds' },
  { value: 'under3min', label: 'Under 3 minutes' },
  { value: 'under5min', label: 'Under 5 minutes' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hi', label: 'Hindi' },
];

const LAYOUT_OPTIONS = [
  { value: 'auto', label: 'Auto (AI chooses best)' },
  { value: 'fill', label: 'Fill (crop to fit)' },
  { value: 'fit', label: 'Fit (letterbox)' },
  { value: 'square', label: 'Square (1:1)' },
];

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}

function CustomSelect({ value, onChange, options, placeholder, className }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <button
        type="button"
        className="brand-field-shell w-full"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="brand-field-shell__input text-left">
          {selectedOption?.label || placeholder || 'Select...'}
        </span>
        <span className="brand-field-shell__suffix pointer-events-none">
          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
        </span>
      </button>
      {isOpen && (
        <div className="absolute z-20 mt-1.5 w-full max-h-48 overflow-y-auto rounded-xl border border-[#DED4CB] bg-white shadow-[0_10px_24px_-10px_rgba(15,8,43,0.28)]">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                'w-full px-3 py-2.5 text-left font-heading text-[clamp(12px,1.37vh,14px)] hover:bg-gray-50',
                opt.value === value ? 'text-[#E86512] bg-orange-50' : 'text-[#212121]'
              )}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface CustomCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: React.ReactNode;
}

function CustomCheckbox({ checked, onChange, label, icon }: CustomCheckboxProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        className={cn(
          'w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all',
          checked
            ? 'bg-[#E86512] border-[#E86512]'
            : 'border-[#DED4CB] bg-white group-hover:border-[#E86512]/50'
        )}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <span className="text-sm text-[#212121] font-heading flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </label>
  );
}

export default function SsembleClipGeneratorModal({
  isOpen,
  onClose,
  sourceVideo,
  campaignId,
  onGenerate,
}: SsembleClipGeneratorModalProps) {
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(300);
  const [preferredLength, setPreferredLength] = useState('under30sec');
  const [language, setLanguage] = useState('en');
  const [captionLanguage, setCaptionLanguage] = useState('');
  const [layout, setLayout] = useState('auto');

  const [hookTitle, setHookTitle] = useState(true);
  const [memeHook, setMemeHook] = useState(false);
  const [memeHookName, setMemeHookName] = useState('');
  const [gameVideo, setGameVideo] = useState(false);
  const [gameVideoName, setGameVideoName] = useState('');
  const [ctaEnabled, setCtaEnabled] = useState(false);
  const [ctaText, setCtaText] = useState('');
  const [music, setMusic] = useState(false);
  const [musicName, setMusicName] = useState('');
  const [musicVolume, setMusicVolume] = useState(10);
  const [templateId, setTemplateId] = useState('');

  const [templates, setTemplates] = useState<any[]>([]);
  const [musicList, setMusicList] = useState<any[]>([]);
  const [memeHooks, setMemeHooks] = useState<any[]>([]);
  const [gameVideos, setGameVideos] = useState<any[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadCatalogs();
    }
  }, [isOpen]);

  const loadCatalogs = async () => {
    setLoadingCatalog(true);
    try {
      const [templatesRes, musicRes, hooksRes, gamesRes] = await Promise.all([
        apiClient.getSsembleTemplates().catch(() => ({ data: [] })),
        apiClient.getSsembleMusic().catch(() => ({ data: [] })),
        apiClient.getSsembleMemeHooks().catch(() => ({ data: [] })),
        apiClient.getSsembleGameVideos().catch(() => ({ data: [] })),
      ]);
      setTemplates(templatesRes.data || []);
      setMusicList(musicRes.data || []);
      setMemeHooks(hooksRes.data || []);
      setGameVideos(gamesRes.data || []);
    } catch (err) {
      console.error('Failed to load catalogs:', err);
    } finally {
      setLoadingCatalog(false);
    }
  };

  const validateForm = (): boolean => {
    if (startSec >= endSec) {
      setError('End time must be after start time');
      return false;
    }
    if (endSec - startSec > 1200) {
      setError('Maximum clip window is 20 minutes');
      return false;
    }
    if (endSec - startSec < 10) {
      setError('Minimum clip duration is 10 seconds');
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sourceVideo || !validateForm()) return;

    setIsSubmitting(true);
    try {
      const data: any = {
        sourceVideoId: sourceVideo.id,
        startSec,
        endSec,
        preferredLength,
        language,
        layout,
      };

      if (captionLanguage) data.captionLanguage = captionLanguage;
      if (templateId) data.templateId = templateId;
      if (hookTitle) data.hookTitle = true;
      if (memeHook) {
        data.memeHook = true;
        if (memeHookName) data.memeHookName = memeHookName;
      }
      if (gameVideo) {
        data.gameVideo = true;
        if (gameVideoName) data.gameVideoName = gameVideoName;
      }
      if (ctaEnabled) {
        data.ctaEnabled = true;
        if (ctaText) data.ctaText = ctaText;
      }
      if (music) {
        data.music = true;
        if (musicName) data.musicName = musicName;
        data.musicVolume = musicVolume;
      }

      await onGenerate(data);
      handleClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to start clip generation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setStartSec(0);
    setEndSec(300);
    setPreferredLength('under30sec');
    setLanguage('en');
    setCaptionLanguage('');
    setLayout('auto');
    setHookTitle(true);
    setMemeHook(false);
    setMemeHookName('');
    setGameVideo(false);
    setGameVideoName('');
    setCtaEnabled(false);
    setCtaText('');
    setMusic(false);
    setMusicName('');
    setMusicVolume(10);
    setTemplateId('');
    setError('');
    onClose();
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen || !sourceVideo) return null;

  const templateOptions = [
    { value: '', label: 'Auto (AI selects)' },
    ...templates.map((tpl) => ({ value: tpl.id, label: tpl.name })),
  ];

  const memeHookOptions = [
    { value: '', label: 'Random' },
    ...memeHooks.map((hook) => ({ value: hook.name, label: hook.name })),
  ];

  const gameVideoOptions = [
    { value: '', label: 'Random' },
    ...gameVideos.map((game) => ({ value: game.name, label: game.name })),
  ];

  const musicOptions = [
    { value: '', label: 'AI selects' },
    ...musicList.map((track) => ({ value: track.name, label: track.name })),
  ];

  const captionLanguageOptions = [
    { value: '', label: 'Same as video' },
    ...LANGUAGE_OPTIONS,
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90dvh]">
        {/* Fixed Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Scissors className="w-5 h-5 text-[#E86512]" />
            <h2 className="text-lg font-semibold text-[#212121] font-heading">Generate AI Clips</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Fixed Video Preview */}
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex gap-4">
            <div className="w-48 aspect-video rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
              {sourceVideo.urlType === 'YOUTUBE' ? (
                <YouTubeEmbed url={sourceVideo.url} className="w-full h-full" />
              ) : (
                <video
                  src={sourceVideo.url}
                  className="w-full h-full object-cover"
                  muted
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-[#212121] truncate">
                {sourceVideo.title || 'Source Video'}
              </h3>
              <p className="text-xs text-text-secondary mt-1 truncate">
                {sourceVideo.url}
              </p>
              {sourceVideo.durationSecs && (
                <p className="text-xs text-text-secondary mt-1">
                  Duration: {formatTime(sourceVideo.durationSecs)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">
            {/* Time Selection */}
            <div>
              <h3 className="text-sm font-semibold text-[#212121] mb-3 font-heading flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#E86512]" />
                Clip Time Range
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Start Time (seconds)
                  </label>
                  <div className="brand-field-shell">
                    <input
                      type="number"
                      min={0}
                      value={startSec}
                      onChange={(e) => setStartSec(Number(e.target.value))}
                      className="brand-field-shell__input"
                    />
                    <span className="brand-field-shell__suffix text-xs">{formatTime(startSec)}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    End Time (seconds)
                  </label>
                  <div className="brand-field-shell">
                    <input
                      type="number"
                      min={startSec + 10}
                      value={endSec}
                      onChange={(e) => setEndSec(Number(e.target.value))}
                      className="brand-field-shell__input"
                    />
                    <span className="brand-field-shell__suffix text-xs">{formatTime(endSec)}</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-text-secondary mt-2">
                Duration: {formatTime(endSec - startSec)} (max 20 minutes)
              </p>
            </div>

            {/* Output Settings */}
            <div>
              <h3 className="text-sm font-semibold text-[#212121] mb-3 font-heading flex items-center gap-2">
                <Scissors className="w-4 h-4 text-[#E86512]" />
                Output Settings
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Preferred Length
                  </label>
                  <CustomSelect
                    value={preferredLength}
                    onChange={setPreferredLength}
                    options={PREFERRED_LENGTH_OPTIONS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Layout
                  </label>
                  <CustomSelect
                    value={layout}
                    onChange={setLayout}
                    options={LAYOUT_OPTIONS}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    <Globe className="w-3 h-3 inline mr-1" />
                    Video Language
                  </label>
                  <CustomSelect
                    value={language}
                    onChange={setLanguage}
                    options={LANGUAGE_OPTIONS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Caption Language
                  </label>
                  <CustomSelect
                    value={captionLanguage}
                    onChange={setCaptionLanguage}
                    options={captionLanguageOptions}
                  />
                </div>
              </div>

              {templates.length > 0 && (
                <div className="mt-4">
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    <Sparkles className="w-3 h-3 inline mr-1" />
                    Template
                  </label>
                  <CustomSelect
                    value={templateId}
                    onChange={setTemplateId}
                    options={templateOptions}
                  />
                </div>
              )}
            </div>

            {/* Enhancements */}
            <div>
              <h3 className="text-sm font-semibold text-[#212121] mb-3 font-heading flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#E86512]" />
                Enhancements
              </h3>
              <div className="space-y-4">
                <CustomCheckbox
                  checked={hookTitle}
                  onChange={setHookTitle}
                  label="Add AI-generated hook title"
                />

                <div className="space-y-2">
                  <CustomCheckbox
                    checked={memeHook}
                    onChange={setMemeHook}
                    label="Add meme hook overlay"
                    icon={<Sparkles className="w-4 h-4 text-[#E86512]" />}
                  />
                  {memeHook && memeHooks.length > 0 && (
                    <div className="ml-8">
                      <CustomSelect
                        value={memeHookName}
                        onChange={setMemeHookName}
                        options={memeHookOptions}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <CustomCheckbox
                    checked={gameVideo}
                    onChange={setGameVideo}
                    label="Add background game video"
                    icon={<Gamepad2 className="w-4 h-4 text-[#E86512]" />}
                  />
                  {gameVideo && gameVideos.length > 0 && (
                    <div className="ml-8">
                      <CustomSelect
                        value={gameVideoName}
                        onChange={setGameVideoName}
                        options={gameVideoOptions}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <CustomCheckbox
                    checked={music}
                    onChange={setMusic}
                    label="Add background music"
                    icon={<Music className="w-4 h-4 text-[#E86512]" />}
                  />
                  {music && (
                    <div className="ml-8 space-y-3">
                      {musicList.length > 0 && (
                        <CustomSelect
                          value={musicName}
                          onChange={setMusicName}
                          options={musicOptions}
                        />
                      )}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-text-secondary whitespace-nowrap">Volume:</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={musicVolume}
                          onChange={(e) => setMusicVolume(Number(e.target.value))}
                          className="flex-1 accent-[#E86512]"
                        />
                        <span className="text-xs text-text-secondary w-8 text-right">
                          {musicVolume}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <CustomCheckbox
                    checked={ctaEnabled}
                    onChange={setCtaEnabled}
                    label="Add call-to-action text"
                    icon={<MessageSquare className="w-4 h-4 text-[#E86512]" />}
                  />
                  {ctaEnabled && (
                    <div className="ml-8">
                      <input
                        type="text"
                        value={ctaText}
                        onChange={(e) => setCtaText(e.target.value)}
                        placeholder="Follow for more!"
                        maxLength={200}
                        className="brand-field-capsule"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Fixed Footer */}
        <div className="px-5 py-4 border-t border-gray-100 bg-white">
          {error && (
            <p className="text-sm text-red-600 mb-3">{error}</p>
          )}
          <div className="flex gap-3">
            <BrandSecondaryButton
              type="button"
              onClick={handleClose}
              className="flex-1"
            >
              Cancel
            </BrandSecondaryButton>
            <BrandPrimaryButton
              type="submit"
              disabled={isSubmitting || loadingCatalog}
              className="flex-1"
              onClick={handleSubmit}
            >
              {isSubmitting ? 'Starting...' : 'Generate Clips'}
            </BrandPrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
