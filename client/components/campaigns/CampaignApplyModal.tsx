'use client';

import { useCallback, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';
import { ProjectLibraryPickerModal } from './ProjectLibraryPickerModal';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { FolderOpen, Upload, Link2, X } from 'lucide-react';

export type ApplySourceType = 'PROJECT_LIBRARY' | 'UPLOAD' | 'EXTERNAL_URL';

interface CampaignApplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName?: string;
  mode?: 'apply' | 'replace';
  onComplete: (assetId: string) => void;
}

const tabs: { id: ApplySourceType; label: string; Icon: typeof FolderOpen }[] = [
  { id: 'PROJECT_LIBRARY', label: 'From projects', Icon: FolderOpen },
  { id: 'UPLOAD', label: 'Upload video', Icon: Upload },
  { id: 'EXTERNAL_URL', label: 'Video URL', Icon: Link2 },
];

export function CampaignApplyModal({
  isOpen,
  onClose,
  campaignId,
  campaignName,
  mode = 'apply',
  onComplete,
}: CampaignApplyModalProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sourceType, setSourceType] = useState<ApplySourceType>('PROJECT_LIBRARY');
  const [draftAssetId, setDraftAssetId] = useState('');
  const [draftMediaUrl, setDraftMediaUrl] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [isProjectLibraryOpen, setIsProjectLibraryOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [urlIngestBusy, setUrlIngestBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const resetForm = useCallback(() => {
    setSourceType('PROJECT_LIBRARY');
    setDraftAssetId('');
    setDraftMediaUrl('');
    setProjectId('');
    setProjectTitle('');
    setUploadFileName(null);
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleTabChange = (newType: ApplySourceType) => {
    if (newType === sourceType) return;
    setSourceType(newType);
    setDraftAssetId('');
    setDraftMediaUrl('');
    setProjectId('');
    setProjectTitle('');
    setUploadFileName(null);
  };

  const handleFileUpload = async (file: File) => {
    if (!file || !campaignId) return;
    setUploadFileName(file.name);
    setDraftAssetId('');
    setProjectTitle(file.name);
    setUploadBusy(true);

    try {
      const response = await apiClient.uploadCreatorDraftAsset(file, { campaignId });
      const assetId = response.data?.assetId;
      if (assetId) {
        setDraftAssetId(assetId);
        showToast('Video processed', 'success');
      } else {
        showToast(response.error || 'Upload did not return an asset id', 'error');
        setUploadFileName(null);
      }
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Upload failed', 'error');
      setUploadFileName(null);
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUrlIngest = async (): Promise<boolean> => {
    if (!campaignId || !draftMediaUrl.trim()) return false;
    setUrlIngestBusy(true);
    try {
      const res = await apiClient.ingestCreatorDraftFromUrl(draftMediaUrl.trim(), { campaignId });
      const aid = res.data?.assetId;
      if (aid) {
        setDraftAssetId(aid);
        setProjectTitle('Video URL');
        showToast('URL imported — you can now continue', 'success');
        return true;
      }
      showToast(res.error || 'Import did not return an asset id', 'error');
      return false;
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Import failed', 'error');
      return false;
    } finally {
      setUrlIngestBusy(false);
    }
  };

  const handleProjectSelectedDeferred = (selectedProjectId: string, meta: { title: string }) => {
    setProjectId(selectedProjectId);
    setProjectTitle(meta.title);
    setDraftAssetId('');
    setIsProjectLibraryOpen(false);
  };

  const handleProjectAssetReady = (assetId: string, meta: { projectId: string; title: string }) => {
    setDraftAssetId(assetId);
    setProjectId(meta.projectId);
    setProjectTitle(meta.title);
    setIsProjectLibraryOpen(false);
  };

  const handleConfirm = async () => {
    if (sourceType === 'EXTERNAL_URL' && !draftAssetId) {
      if (!draftMediaUrl.trim()) {
        showToast('Enter a video URL first', 'error');
        return;
      }
      await handleUrlIngest();
      return;
    }

    if (sourceType === 'PROJECT_LIBRARY' && projectId && !draftAssetId) {
      setConfirmBusy(true);
      try {
        const res = await apiClient.ingestCreatorDraftFromProject(projectId, { campaignId });
        const aid = res.data?.assetId;
        if (aid) {
          onComplete(aid);
          handleClose();
        } else {
          showToast(res.error || 'Could not process project video', 'error');
        }
      } catch (e: unknown) {
        showToast(e instanceof Error ? e.message : 'Processing failed', 'error');
      } finally {
        setConfirmBusy(false);
      }
      return;
    }

    if (!draftAssetId) {
      showToast('Please select or upload a video first', 'error');
      return;
    }
    onComplete(draftAssetId);
    handleClose();
  };

  const isBusy = uploadBusy || urlIngestBusy || confirmBusy;
  const urlNeedsValidation = sourceType === 'EXTERNAL_URL' && !draftAssetId;
  const hasSelection = Boolean(draftAssetId) || (sourceType === 'PROJECT_LIBRARY' && Boolean(projectId));
  const canConfirm = !isBusy && (urlNeedsValidation ? Boolean(draftMediaUrl.trim()) : hasSelection);
  const primaryLabel = confirmBusy
    ? 'Processing…'
    : urlIngestBusy
      ? 'Validating…'
      : uploadBusy
        ? 'Processing…'
        : urlNeedsValidation
          ? 'Validate & import'
          : mode === 'replace'
            ? 'Use this video'
            : 'Continue with this video';

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} className="max-w-2xl">
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="brand-page-section-title">
              {mode === 'replace' ? 'Replace draft video' : 'Apply to campaign'}
            </h3>
            <button
              type="button"
              className="rounded-full p-2 text-[#616161] hover:bg-orange-50"
              aria-label="Close"
              onClick={handleClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {campaignName && (
            <p className="mb-4 text-sm text-[#616161]">
              Campaign: <span className="font-medium text-[#212121]">{campaignName}</span>
            </p>
          )}

          {/* Tab Navigation - full width, equally distributed */}
          <div
            className="mb-4 inline-flex w-full max-w-full rounded-[28px] p-[2px]"
            style={{ background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }}
          >
            <div
              className="inline-flex w-full min-w-0 flex-row items-center gap-0.5 overflow-x-auto rounded-[26px] bg-white p-1"
              role="tablist"
              aria-label="Draft video source"
            >
              {tabs.map((tab) => {
                const Icon = tab.Icon;
                const selected = sourceType === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className="brand-campaigns-tab inline-flex min-h-[2.25rem] flex-1 basis-0 items-center justify-center gap-1.5 text-center"
                    onClick={() => handleTabChange(tab.id)}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab Content */}
          <div className="rounded-2xl border border-[#E8E2DB] bg-[#F9F7F4] p-4">
            {sourceType === 'PROJECT_LIBRARY' && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[#616161]">
                  {projectId && !draftAssetId
                    ? `Selected: ${projectTitle || 'Project video'} — will be processed on apply`
                    : draftAssetId
                      ? `Ready: ${projectTitle || 'Project video'} (processed)`
                      : 'Pick a completed project — we will watermark a preview for the brand.'}
                </p>
                <BrandSecondaryButton
                  type="button"
                  size="sm"
                  onClick={() => setIsProjectLibraryOpen(true)}
                >
                  {projectId || draftAssetId ? 'Change video' : 'Browse videos'}
                </BrandSecondaryButton>
              </div>
            )}

            {sourceType === 'UPLOAD' && (
              <div className="space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileUpload(file);
                  }}
                />
                {uploadFileName ? (
                  <p className="text-sm text-[#616161]">
                    Selected:{' '}
                    <span className="break-all font-medium text-[#212121]">{uploadFileName}</span>
                    {uploadBusy && (
                      <span className="ml-2 font-heading font-medium text-[#E86512]">Processing…</span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-[#616161]">Choose a video file from your device.</p>
                )}
                <BrandSecondaryButton
                  type="button"
                  size="sm"
                  disabled={uploadBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadBusy ? 'Processing…' : draftAssetId ? 'Replace video' : 'Upload draft video'}
                </BrandSecondaryButton>
                {draftAssetId && (
                  <p className="text-xs text-emerald-700">Video ready — you can proceed.</p>
                )}
                {uploadFileName && !uploadBusy && !draftAssetId && (
                  <p className="text-xs text-red-700">Upload could not be processed. Please try again.</p>
                )}
              </div>
            )}

            {sourceType === 'EXTERNAL_URL' && (
              <div className="space-y-3">
                <Input
                  variant="brandCapsule"
                  placeholder="Google Drive, Dropbox, OneDrive, or direct video link (mp4, mov…)"
                  value={draftMediaUrl}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDraftMediaUrl(next);
                    if (draftAssetId) setDraftAssetId('');
                  }}
                  icon={<Link2 className="h-4 w-4 text-[#9E9E9E]" />}
                  iconPosition="left"
                />
                {draftAssetId && (
                  <p className="text-xs text-emerald-700">URL imported — video ready.</p>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-5 flex items-center justify-end gap-2">
            <BrandSecondaryButton type="button" size="sm" onClick={handleClose}>
              Cancel
            </BrandSecondaryButton>
            <BrandPrimaryButton
              type="button"
              size="sm"
              disabled={!canConfirm}
              onClick={handleConfirm}
            >
              {primaryLabel}
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>

      <ProjectLibraryPickerModal
        isOpen={isProjectLibraryOpen}
        onClose={() => setIsProjectLibraryOpen(false)}
        campaignId={campaignId}
        deferProcessing
        onProjectSelected={handleProjectSelectedDeferred}
        onAssetReady={handleProjectAssetReady}
      />
    </>
  );
}
