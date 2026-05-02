'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/hooks/useAuth';

const CAMPAIGN_WS_URL = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL?.replace('/api', '') || 'http://localhost:9011';

export type CampaignEventType =
  | 'campaign:application:new'
  | 'campaign:application:reviewed'
  | 'campaign:application:draft_replaced'
  | 'campaign:post:submitted'
  | 'campaign:post:verified'
  | 'campaign:post:rejected'
  | 'campaign:status:changed'
  | 'campaign:deadline:approaching'
  | 'campaign:earnings:accrued'
  | 'campaign:earnings:available';

export interface CampaignEvent {
  type: CampaignEventType;
  campaignId: string;
  campaignName?: string;
  applicationId?: string;
  creatorId?: string;
  brandId?: string;
  postId?: string;
  status?: string;
  message?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

interface CampaignEventsContextType {
  socket: Socket | null;
  isConnected: boolean;
  subscribeToCampaign: (campaignId: string, handler: (event: CampaignEvent) => void) => () => void;
  unsubscribeFromCampaign: (campaignId: string) => void;
  addGlobalHandler: (handler: (event: CampaignEvent) => void) => () => void;
}

const CampaignEventsContext = createContext<CampaignEventsContextType>({
  socket: null,
  isConnected: false,
  subscribeToCampaign: () => () => {},
  unsubscribeFromCampaign: () => {},
  addGlobalHandler: () => () => {},
});

export function CampaignEventsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const campaignHandlersRef = useRef<Map<string, Set<(event: CampaignEvent) => void>>>(new Map());
  const globalHandlersRef = useRef<Set<(event: CampaignEvent) => void>>(new Set());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isManuallyClosedRef = useRef(false);

  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000;

  const connect = useCallback(() => {
    if (!isAuthenticated || isManuallyClosedRef.current) {
      return;
    }

    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('authToken') || sessionStorage.getItem('authToken')
        : null;

    if (!token) {
      console.warn('[CampaignEventsContext] No auth token available');
      return;
    }

    console.log('[CampaignEventsContext] Connecting to', `${CAMPAIGN_WS_URL}/campaign-events`);

    socketRef.current = io(`${CAMPAIGN_WS_URL}/campaign-events`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: baseReconnectDelay,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: maxReconnectAttempts,
      forceNew: true,
      autoConnect: true,
    });

    socketRef.current.on('connect_error', (error: Error) => {
      console.error('[CampaignEventsContext] Connection error:', error.message);
      setIsConnected(false);
    });

    socketRef.current.on('connect', () => {
      console.log('[CampaignEventsContext] Connected:', socketRef.current?.id);
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      isManuallyClosedRef.current = false;

      campaignHandlersRef.current.forEach((handlers, campaignId) => {
        if (handlers.size > 0) {
          socketRef.current?.emit('subscribe-campaign', { campaignId });
        }
      });
    });

    socketRef.current.on('disconnect', (reason: string) => {
      console.log('[CampaignEventsContext] Disconnected:', reason);
      setIsConnected(false);

      if (!isManuallyClosedRef.current && reason !== 'io client disconnect') {
        const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;

        if (reconnectAttemptsRef.current <= maxReconnectAttempts) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      }
    });

    socketRef.current.on('campaign-event', (event: CampaignEvent) => {
      console.log('[CampaignEventsContext] Event received:', event.type, event.campaignId);

      globalHandlersRef.current.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error('[CampaignEventsContext] Error in global handler:', error);
        }
      });

      const handlers = campaignHandlersRef.current.get(event.campaignId);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(event);
          } catch (error) {
            console.error('[CampaignEventsContext] Error in campaign handler:', error);
          }
        });
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
    campaignHandlersRef.current.clear();
    globalHandlersRef.current.clear();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      isManuallyClosedRef.current = false;
      connect();
    } else {
      disconnect();
    }

    return () => {
      if (!isAuthenticated) {
        disconnect();
      }
    };
  }, [isAuthenticated, connect, disconnect]);

  const subscribeToCampaign = useCallback(
    (campaignId: string, handler: (event: CampaignEvent) => void) => {
      if (!campaignHandlersRef.current.has(campaignId)) {
        campaignHandlersRef.current.set(campaignId, new Set());
      }
      campaignHandlersRef.current.get(campaignId)!.add(handler);

      if (socketRef.current?.connected) {
        socketRef.current?.emit('subscribe-campaign', { campaignId });
      }

      return () => {
        const handlers = campaignHandlersRef.current.get(campaignId);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            campaignHandlersRef.current.delete(campaignId);
            if (socketRef.current?.connected) {
              socketRef.current?.emit('unsubscribe-campaign', { campaignId });
            }
          }
        }
      };
    },
    [],
  );

  const unsubscribeFromCampaign = useCallback((campaignId: string) => {
    campaignHandlersRef.current.delete(campaignId);
    if (socketRef.current?.connected) {
      socketRef.current?.emit('unsubscribe-campaign', { campaignId });
    }
  }, []);

  const addGlobalHandler = useCallback((handler: (event: CampaignEvent) => void) => {
    globalHandlersRef.current.add(handler);
    return () => {
      globalHandlersRef.current.delete(handler);
    };
  }, []);

  return (
    <CampaignEventsContext.Provider
      value={{
        socket: socketRef.current,
        isConnected,
        subscribeToCampaign,
        unsubscribeFromCampaign,
        addGlobalHandler,
      }}
    >
      {children}
    </CampaignEventsContext.Provider>
  );
}

export function useCampaignEventsContext() {
  return useContext(CampaignEventsContext);
}

export function useCampaignEventSubscription(
  campaignId: string | null | undefined,
  handler: (event: CampaignEvent) => void,
) {
  const { subscribeToCampaign } = useCampaignEventsContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!campaignId) return;

    const stableHandler = (event: CampaignEvent) => {
      handlerRef.current(event);
    };

    return subscribeToCampaign(campaignId, stableHandler);
  }, [campaignId, subscribeToCampaign]);
}
