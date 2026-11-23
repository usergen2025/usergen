'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { consumeTranslationIntent } from '@/lib/marketing/translation-intent';

/**
 * Silent bootstrap for the home "Translate your video" tab.
 *
 * Creates the uploaded-source project, then hands off to the existing
 * workspace completed screen with the language modal already open. There is
 * no dedicated translate UI here — that layout looked broken under the app
 * header; workspace already owns the right chrome.
 */
export default function TranslateVideoBootstrapPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !isAuthenticated || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        const pending = await consumeTranslationIntent();
        if (!pending?.videoUrl && !pending?.file) {
          setError(
            'No video to translate. Go back to home and paste a URL or upload a file.',
          );
          return;
        }

        const response = await apiClient.createTranslationSource({
          videoUrl: pending.videoUrl,
          file: pending.file || undefined,
        });

        if (!response.success || !response.data?.id) {
          throw new Error(
            (response as any).error ||
              (response as any).message ||
              'Failed to prepare video for translation',
          );
        }

        const projectId = response.data.id as string;
        router.replace(
          `/create-video/workspace?projectId=${encodeURIComponent(projectId)}&openTranslate=1`,
        );
      } catch (err: any) {
        const message =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          'Could not access that video. Use a public link or upload the file.';
        setError(Array.isArray(message) ? message.join(', ') : String(message));
        showToast(
          Array.isArray(message) ? message.join(', ') : String(message),
          'error',
        );
      }
    })();
  }, [authLoading, isAuthenticated, router, showToast]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <>
          <p className="max-w-md text-sm text-[#5C5C5C]">{error}</p>
          <button
            type="button"
            onClick={() => router.push('/home')}
            className="rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] px-4 py-2 text-sm font-semibold text-white"
          >
            Back to home
          </button>
        </>
      ) : (
        <>
          <Loader2 className="size-6 animate-spin text-[#E86412]" />
          <p className="text-sm text-[#5C5C5C]">Opening workspace…</p>
        </>
      )}
    </div>
  );
}
