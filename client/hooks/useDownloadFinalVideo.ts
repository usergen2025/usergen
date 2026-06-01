'use client';

import { useCallback, useRef, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { downloadAuthenticatedProxyWithFallback } from '@/lib/download-video';

/**
 * Download clean final video as a file (local server path or GCS via authenticated stream).
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
      const saveAs =
        (response.success && response.data?.filename) ||
        defaultFilename ||
        `project-${projectId}.mp4`;

      await downloadAuthenticatedProxyWithFallback(projectId, saveAs);

      showToast('Download started', 'success');
    } catch (err) {
      console.error('[Download] Failed:', err);
      const message =
        err instanceof Error ? err.message : 'Download failed';
      setError(message);
      showToast(message || 'Download failed. Please try again.', 'error');
    } finally {
      setIsDownloading(false);
      inFlightRef.current = false;
    }
  }, [projectId, defaultFilename, showToast]);

  return { download, isDownloading, error };
}
