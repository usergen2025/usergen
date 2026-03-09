'use client';

/**
 * Toast Notification System
 * Light theme matching app design (warm palette)
 */

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: Toast = { id, message, type, duration };

    setToasts((prev) => [...prev, newToast]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-[310px] max-w-[calc(100vw-2rem)]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveDuration =
    toast.duration === 0
      ? 0
      : toast.duration !== undefined && toast.duration > 0
        ? toast.duration
        : toast.type === 'error'
          ? 10000
          : 3000;

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => {
      onRemove(toast.id);
      closeTimerRef.current = null;
    }, 500);
  }, [isClosing, onRemove, toast.id]);

  useEffect(() => {
    setTimeout(() => setIsVisible(true), 10);
  }, []);

  useEffect(() => {
    if (effectiveDuration > 0) {
      timerRef.current = setTimeout(handleClose, effectiveDuration);
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
      };
    }
  }, [effectiveDuration, handleClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const icons = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const iconPanelStyles = {
    success: 'bg-emerald-50',
    error: 'bg-red-50',
    warning: 'bg-amber-50',
    info: 'bg-sky-50',
  };

  const iconStyles = {
    success: 'text-emerald-600',
    error: 'text-red-600',
    warning: 'text-amber-600',
    info: 'text-sky-600',
  };

  const Icon = icons[toast.type];

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center w-full overflow-hidden rounded-2xl border border-[var(--border-light)] bg-white shadow-[var(--shadow-card)] transition-all duration-500',
        isVisible && !isClosing ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0',
        isClosing && 'translate-y-[-20px] opacity-0'
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-l-2xl p-4',
          iconPanelStyles[toast.type]
        )}
      >
        <Icon className={cn('h-6 w-6', iconStyles[toast.type])} />
      </div>
      <p className="min-w-0 flex-1 px-4 py-4 text-sm font-medium leading-[1.5] tracking-[-0.02em] text-[var(--text-primary)]">
        {toast.message}
      </p>
      <button
        type="button"
        onClick={handleClose}
        className="shrink-0 p-4 text-[var(--text-muted)] transition-opacity hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 focus:ring-offset-2 focus:ring-offset-white"
        aria-label="Dismiss"
      >
        <X className="h-6 w-6" />
      </button>
    </div>
  );
}
