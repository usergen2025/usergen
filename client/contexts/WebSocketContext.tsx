'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/hooks/useAuth';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';

export interface JobStatusUpdate {
  jobId: string;
  queueType: 'audio-generation' | 'image-generation' | 'video-generation';
  state: 'completed' | 'failed' | 'processing';
  result?: any;
  progress?: number;
  error?: string;
}

interface WebSocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  subscribeToJob: (jobId: string, queueType: string, handler: (update: JobStatusUpdate) => void) => () => void;
  unsubscribeFromJob: (jobId: string) => void;
}

const WebSocketContext = createContext<WebSocketContextType>({
  socket: null,
  isConnected: false,
  subscribeToJob: () => () => {},
  unsubscribeFromJob: () => {},
});

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const jobHandlersRef = useRef<Map<string, Set<(update: JobStatusUpdate) => void>>>(new Map());
  const jobQueueTypesRef = useRef<Map<string, string>>(new Map()); // Track queue type per job
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isManuallyClosedRef = useRef(false);

  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000;

  const connect = useCallback(() => {
    if (!isAuthenticated || isManuallyClosedRef.current) {
      console.log('[WebSocketContext] ⏸️ Connection skipped:', {
        isAuthenticated,
        manuallyClosed: isManuallyClosedRef.current,
      });
      return;
    }

    // Clean up any existing socket connection before creating a new one
    if (socketRef.current) {
      console.log('[WebSocketContext] Cleaning up existing socket:', {
        id: socketRef.current.id,
        connected: socketRef.current.connected,
      });
      socketRef.current.removeAllListeners(); // Remove all listeners to prevent duplicate handlers
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const token = typeof window !== 'undefined'
      ? (localStorage.getItem('authToken') || sessionStorage.getItem('authToken'))
      : null;

    if (!token) {
      console.warn('[WebSocketContext] ❌ No auth token available');
      return;
    }

    console.log('[WebSocketContext] 🔌 Attempting to connect to', `${WS_URL}/job-status`);
    console.log('[WebSocketContext] Connection details:', {
      url: WS_URL,
      namespace: '/job-status',
      fullUrl: `${WS_URL}/job-status`,
      hasToken: !!token,
      tokenLength: token?.length || 0,
    });

    // Connect to backend socket.io namespace directly
    // Socket.IO namespaces are specified in the URL, not via path option
    // The path option is for the Socket.IO server path (default /socket.io/), not the namespace
    socketRef.current = io(`${WS_URL}/job-status`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: baseReconnectDelay,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: maxReconnectAttempts,
      forceNew: true, // Force a new connection
      autoConnect: true, // Ensure auto-connect is enabled
    });

    // Log socket creation
    console.log('[WebSocketContext] Socket instance created:', {
      id: socketRef.current?.id,
      connected: socketRef.current?.connected,
      disconnected: socketRef.current?.disconnected,
    });

    // Add ALL socket.io event listeners for debugging
    socketRef.current.on('connecting', () => {
      console.log('[WebSocketContext] 🔄 Socket connecting...');
    });

    socketRef.current.on('reconnect_attempt', (attemptNumber: number) => {
      console.log(`[WebSocketContext] 🔄 Reconnection attempt ${attemptNumber}`);
    });

    socketRef.current.on('reconnect', (attemptNumber: number) => {
      console.log(`[WebSocketContext] ✅ Reconnected after ${attemptNumber} attempts`);
    });

    socketRef.current.on('reconnect_error', (error: Error) => {
      console.error('[WebSocketContext] ❌ Reconnection error:', error.message);
    });

    socketRef.current.on('reconnect_failed', () => {
      console.error('[WebSocketContext] ❌ Reconnection failed - max attempts reached');
    });

    // Attach error handlers FIRST, before connection attempt
    socketRef.current.on('connect_error', (error: Error) => {
      console.error('[WebSocketContext] ❌ Connection error:', error.message);
      console.error('[WebSocketContext] Connection details:', {
        url: WS_URL,
        namespace: '/job-status',
        authToken: token ? 'Present' : 'Missing',
        errorType: error.name,
        errorStack: error.stack,
        socketId: socketRef.current?.id,
        socketConnected: socketRef.current?.connected,
      });
      setIsConnected(false);
    });

    socketRef.current.on('connect', () => {
      console.log('[WebSocketContext] ✅ Socket connected successfully:', socketRef.current?.id);
      console.log('[WebSocketContext] Socket connection details:', {
        id: socketRef.current?.id,
        connected: socketRef.current?.connected,
        disconnected: socketRef.current?.disconnected,
        transport: socketRef.current?.io?.engine?.transport?.name,
      });
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      isManuallyClosedRef.current = false; // Reset manual close flag on successful connection
      
      // Log all registered handlers to verify they're available
      const registeredJobIds = Array.from(jobHandlersRef.current.keys());
      console.log('[WebSocketContext] 📋 Registered handlers on connect:', registeredJobIds.length, 'jobs:', registeredJobIds);
      
      // Resubscribe to all queued jobs now that we're connected
      registeredJobIds.forEach(jobId => {
        const handlers = jobHandlersRef.current.get(jobId);
        const queueType = jobQueueTypesRef.current.get(jobId);
        if (handlers && handlers.size > 0 && queueType) {
          console.log(`[WebSocketContext] 🔄 Re-subscribing to job ${jobId} (${queueType}) on connect`);
          socketRef.current?.emit('subscribe-job', { jobId, queueType });
        } else if (handlers && handlers.size > 0 && !queueType) {
          console.warn(`[WebSocketContext] ⚠️ Job ${jobId} has handlers but no queue type tracked, cannot re-subscribe`);
        }
      });
    });

    socketRef.current.on('disconnect', (reason: string) => {
      console.log('[WebSocketContext] Disconnected:', reason);
      setIsConnected(false);

      // Only reconnect if not manually closed and not a normal disconnect
      if (!isManuallyClosedRef.current && reason !== 'io client disconnect') {
        const delay = Math.min(
          baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
          30000
        );
        reconnectAttemptsRef.current++;

        if (reconnectAttemptsRef.current <= maxReconnectAttempts) {
          console.log(`[WebSocketContext] Will reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.error('[WebSocketContext] Max reconnection attempts reached');
        }
      }
    });

    // Global job-status-update handler
    socketRef.current.on('job-status-update', (update: JobStatusUpdate) => {
      console.log('[WebSocketContext] 🔔 Raw job-status-update event received:', {
        jobId: update.jobId,
        queueType: update.queueType,
        state: update.state,
        hasResult: !!update.result,
        sceneNumber: update.queueType === 'image-generation' ? update.result?.image?.sceneNumber : update.queueType === 'video-generation' ? update.result?.video?.sceneNumber : undefined,
      });

      // Call all handlers subscribed to this job
      const handlers = jobHandlersRef.current.get(update.jobId);
      if (handlers && handlers.size > 0) {
        console.log(`[WebSocketContext] ✅ Found ${handlers.size} handler(s) for job ${update.jobId}, calling them`);
        handlers.forEach(handler => {
          try {
            handler(update);
          } catch (error) {
            console.error('[WebSocketContext] ❌ Error in job handler:', error);
          }
        });
      } else {
        console.warn(`[WebSocketContext] ⚠️ No handlers found for job ${update.jobId}. Registered jobs:`, Array.from(jobHandlersRef.current.keys()));
      }
    });
  }, [isAuthenticated]);

  const disconnect = useCallback(() => {
    isManuallyClosedRef.current = true;
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
    jobHandlersRef.current.clear();
    jobQueueTypesRef.current.clear();
  }, []);

  useEffect(() => {
    console.log('[WebSocketContext] 🔔 Socket effect triggered, isAuthenticated:', isAuthenticated);
    console.log('[WebSocketContext] Current socket state:', {
      socketExists: !!socketRef.current,
      socketConnected: socketRef.current?.connected,
      socketId: socketRef.current?.id,
      isConnectedState: isConnected,
    });

    if (isAuthenticated) {
      // Reset manual close flag when authenticated
      isManuallyClosedRef.current = false;
      connect();
    } else {
      disconnect();
    }

    return () => {
      // Only cleanup if explicitly logged out
      if (!isAuthenticated) {
        console.log('[WebSocketContext] Cleaning up socket on unmount (user logged out)');
        disconnect();
      }
    };
  }, [isAuthenticated, connect, disconnect]);

  const subscribeToJob = useCallback((jobId: string, queueType: string, handler: (update: JobStatusUpdate) => void) => {
    // CRITICAL: Always register the handler FIRST, even if socket isn't ready
    // This ensures handlers are available when events arrive
    if (!jobHandlersRef.current.has(jobId)) {
      jobHandlersRef.current.set(jobId, new Set());
    }
    jobHandlersRef.current.get(jobId)!.add(handler);
    
    // Track queue type for this job
    jobQueueTypesRef.current.set(jobId, queueType);

    console.log(`[WebSocketContext] ✅ Registered handler for job ${jobId} (${queueType}), socket connected: ${socketRef.current?.connected}`);

    // Now try to subscribe via socket
    if (socketRef.current?.connected) {
      console.log(`[WebSocketContext] 📡 Subscribing to job ${jobId} (${queueType})`);
      socketRef.current?.emit('subscribe-job', { jobId, queueType });
      console.log(`[WebSocketContext] ✅ Subscription request sent for job ${jobId}`);
    } else {
      // Socket not ready yet - queue the subscription
      console.log(`[WebSocketContext] ⏳ Queueing subscription for job ${jobId} - socket not connected`);
      
      // Wait for connection and retry
      let retryCount = 0;
      const maxRetries = 50; // Wait up to 5 seconds (50 * 100ms)

      const waitForConnection = () => {
        if (socketRef.current?.connected) {
          console.log(`[WebSocketContext] 🔄 Retrying subscription to job ${jobId} after connection`);
          socketRef.current?.emit('subscribe-job', { jobId, queueType });
          console.log(`[WebSocketContext] ✅ Subscription request sent for job ${jobId}`);
        } else if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(waitForConnection, 100);
        } else {
          console.error(`[WebSocketContext] ❌ Failed to subscribe to job ${jobId} after ${maxRetries} retries - socket not connected`);
        }
      };
      waitForConnection();
    }

    // Return unsubscribe function
    return () => {
      const handlers = jobHandlersRef.current.get(jobId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          jobHandlersRef.current.delete(jobId);
          jobQueueTypesRef.current.delete(jobId);
          if (socketRef.current?.connected) {
            socketRef.current?.emit('unsubscribe-job', { jobId });
            console.log(`[WebSocketContext] Unsubscribed from job ${jobId}`);
          }
        }
      }
    };
  }, []);

  const unsubscribeFromJob = useCallback((jobId: string) => {
    jobHandlersRef.current.delete(jobId);
    jobQueueTypesRef.current.delete(jobId);
    if (socketRef.current?.connected) {
      socketRef.current?.emit('unsubscribe-job', { jobId });
      console.log(`[WebSocketContext] Unsubscribed from job ${jobId}`);
    }
  }, []);

  return (
    <WebSocketContext.Provider
      value={{
        socket: socketRef.current,
        isConnected,
        subscribeToJob,
        unsubscribeFromJob,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext() {
  return useContext(WebSocketContext);
}

