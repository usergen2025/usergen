'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import { useCampaignEventsContext } from '@/contexts/CampaignEventsContext';
import { useCloseOnRouteChange } from '@/hooks/useCloseOnRouteChange';

const POLL_MS = 20_000;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { addGlobalHandler } = useCampaignEventsContext();

  useCloseOnRouteChange(() => setOpen(false));

  const load = useCallback(async () => {
    const res = await apiClient.getNotifications();
    if (res.success && res.data?.notifications) {
      setItems(res.data.notifications);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = addGlobalHandler(() => {
      load().catch(() => {});
    });
    return unsubscribe;
  }, [addGlobalHandler, load]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const onFocus = () => load().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  /**
   * Right-aligns the panel to the bell, then clamps it inside the viewport.
   * The bell is not the last item in the header, so a plain `right-0` anchor
   * pushes the panel off the left edge on narrow screens.
   */
  const updatePanelPos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 16;
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(360, viewportWidth - margin * 2);
    const left = Math.min(
      Math.max(margin, rect.right - width),
      viewportWidth - margin - width,
    );
    setPanelPos({ top: rect.bottom + 8, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePanelPos();
    window.addEventListener('resize', updatePanelPos);
    window.addEventListener('scroll', updatePanelPos, true);
    return () => {
      window.removeEventListener('resize', updatePanelPos);
      window.removeEventListener('scroll', updatePanelPos, true);
    };
  }, [open, updatePanelPos]);

  const unread = items.filter((n) => !n.read).length;

  const onMarkRead = async (id: string) => {
    await apiClient.markNotificationRead(id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          load();
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#E4D7CF] text-[#8B6C5C] transition-colors hover:border-[#E86412] hover:text-[#E86412]"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#E86412] px-1 text-[10px] font-medium text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && panelPos && (
        <div
          className={cn(
            'fixed z-[60] rounded-xl border border-[#E0D5CF] bg-white shadow-lg',
          )}
          style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
        >
          <div className="max-h-[min(70dvh,420px)] overflow-y-auto py-2">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">No notifications yet</p>
            ) : (
              items.map((n) => {
                const pid = n.data?.projectId as string | undefined;
                const cid = n.data?.campaignId as string | undefined;
                const isCampaignNotification = n.type?.startsWith('CAMPAIGN_');
                const isBrandNotification =
                  n.type === 'CAMPAIGN_APPLICATION_RECEIVED' ||
                  n.type === 'CAMPAIGN_POST_SUBMITTED';

                const getCampaignLink = () => {
                  if (!cid) return null;
                  if (isBrandNotification) {
                    return `/brand/campaigns/${cid}`;
                  }
                  return `/campaigns/${cid}`;
                };

                const campaignLink = getCampaignLink();

                return (
                  <div
                    key={n.id}
                    className={cn(
                      'border-b border-gray-100 px-4 py-3 last:border-0',
                      !n.read && 'bg-orange-50/60',
                    )}
                  >
                    <p className="text-sm font-medium text-[#212121]">{n.title}</p>
                    <p className="mt-1 text-xs text-gray-600">{n.message}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {pid && (
                        <Link
                          href={`/create-video/workspace?projectId=${encodeURIComponent(pid)}`}
                          className="text-xs font-medium text-[#E86412] hover:underline"
                          onClick={() => {
                            setOpen(false);
                            onMarkRead(n.id);
                          }}
                        >
                          Open project
                        </Link>
                      )}
                      {campaignLink && (
                        <Link
                          href={campaignLink}
                          className="text-xs font-medium text-[#E86412] hover:underline"
                          onClick={() => {
                            setOpen(false);
                            onMarkRead(n.id);
                          }}
                        >
                          {isBrandNotification ? 'View applicants' : 'View campaign'}
                        </Link>
                      )}
                      {!n.read && (
                        <button
                          type="button"
                          className="text-xs text-gray-500 hover:text-gray-800"
                          onClick={() => onMarkRead(n.id)}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
