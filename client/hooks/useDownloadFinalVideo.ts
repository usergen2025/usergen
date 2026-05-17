'use client';

import { useCallback, useRef, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function triggerNativeDownload(downloadUrl: string) {
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.rel = 'noopener noreferrer';
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Download clean final video with instant feedback and GCS signed-URL when available.
 */
export function useDownloadFinalVideo(
  projectId: string | null | undefined,
  defaultFilename?: string,
) {
  const { showToast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const download = useCallback(async () => {
    if (!projectId || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsDownloading(true);
    setError(null);
    showToast('Preparing download…', 'info');

    try {
      const response = await apiClient.getVideoDownloadUrl(projectId);
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to get download URL');
      }

      const { downloadUrl, filename, strategy } = response.data;
      const saveAs = filename || defaultFilename || `project-${projectId}.mp4`;

      if (strategy === 'signed_gcs') {
        triggerNativeDownload(downloadUrl);
      } else {
        const blob = await apiClient.downloadVideoProject(projectId);
        triggerBlobDownload(blob, saveAs);
      }

      showToast('Download started', 'success');
    } catch (err) {
      console.error('[Download] Failed:', err);
      const message =
        err instanceof Error ? err.message : 'Download failed';
      setError(message);
      showToast('Download failed. Please try again.', 'error');
    } finally {
      setIsDownloading(false);
      inFlightRef.current = false;
    }
  }, [projectId, defaultFilename, showToast]);

  return { download, isDownloading, error };
}
