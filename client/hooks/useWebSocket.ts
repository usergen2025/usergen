'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useWebSocketContext, JobStatusUpdate } from '@/contexts/WebSocketContext';

interface UseWebSocketOptions {
  onJobStatusUpdate?: (update: JobStatusUpdate) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  enabled?: boolean;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { isConnected, subscribeToJob: contextSubscribeToJob, unsubscribeFromJob } = useWebSocketContext();
  const { onJobStatusUpdate, onConnected, onDisconnected, enabled = true } = options;
  const processedJobsRef = useRef<Set<string>>(new Set());
  const unsubscribeRefsRef = useRef<Map<string, () => void>>(new Map());

  // Load processed jobs from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('processedJobs');
      if (stored) {
        try {
          const jobs = JSON.parse(stored);
          processedJobsRef.current = new Set(jobs);
        } catch (e) {
          console.error('[useWebSocket] Failed to load processed jobs from localStorage');
        }
      }
    }
  }, []);

  // Call onConnected/onDisconnected callbacks when connection state changes
  useEffect(() => {
    if (isConnected) {
      onConnected?.();
    } else {
      onDisconnected?.();
    }
  }, [isConnected, onConnected, onDisconnected]);

  // Wrapper handler that includes duplicate prevention logic
  const handleJobStatusUpdate = useCallback((update: JobStatusUpdate) => {
    console.log('[useWebSocket] 🔔 Job status update received:', {
      jobId: update.jobId,
      queueType: update.queueType,
      state: update.state,
      hasResult: !!update.result,
      sceneNumber: update.queueType === 'image-generation' ? update.result?.image?.sceneNumber : update.queueType === 'video-generation' ? update.result?.video?.sceneNumber : undefined,
    });

    // Allow updates for completed jobs - we want to accept the latest data
    // Duplicate prevention is handled at the component level by checking sceneNumber
    // Only prevent duplicates for failed jobs to avoid spam
    if (update.state === 'failed') {
      const updateKey = `${update.jobId}-${update.queueType}`;
      if (processedJobsRef.current.has(updateKey)) {
        console.log(`[useWebSocket] ⏭️ Failed job ${update.jobId} already processed, skipping update`);
        return;
      }
      processedJobsRef.current.add(updateKey);
    }

    // Persist to localStorage (keep last 100 jobs)
    if (typeof window !== 'undefined' && update.state === 'failed') {
      const jobsArray = Array.from(processedJobsRef.current).slice(-100);
      localStorage.setItem('processedJobs', JSON.stringify(jobsArray));
    }

    // Call the callback - always allow completed updates through
    console.log('[useWebSocket] ➡️ Calling onJobStatusUpdate callback');
    onJobStatusUpdate?.(update);
  }, [onJobStatusUpdate]);

  const subscribeToJob = useCallback((jobId: string, queueType: string) => {
    if (!enabled || !onJobStatusUpdate) {
      console.warn('[useWebSocket] ⚠️ Cannot subscribe - hook disabled or no handler');
      return;
    }

    // Clean up existing subscription for this job if any
    const existingUnsubscribe = unsubscribeRefsRef.current.get(jobId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }

    // Subscribe via context
    const unsubscribe = contextSubscribeToJob(jobId, queueType, handleJobStatusUpdate);
    unsubscribeRefsRef.current.set(jobId, unsubscribe);

    console.log(`[useWebSocket] ✅ Subscribed to job ${jobId} (${queueType})`);
  }, [enabled, onJobStatusUpdate, contextSubscribeToJob, handleJobStatusUpdate]);

  // Cleanup subscriptions on unmount or when disabled
  useEffect(() => {
    return () => {
      unsubscribeRefsRef.current.forEach((unsubscribe) => {
        unsubscribe();
      });
      unsubscribeRefsRef.current.clear();
    };
  }, []);

  // Cleanup when disabled
  useEffect(() => {
    if (!enabled) {
      unsubscribeRefsRef.current.forEach((unsubscribe) => {
        unsubscribe();
      });
      unsubscribeRefsRef.current.clear();
    }
  }, [enabled]);

  return {
    isConnected,
    subscribeToJob,
    unsubscribeFromJob,
  };
}

export type { JobStatusUpdate };
