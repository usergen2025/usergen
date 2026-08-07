'use client';

import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ArrowLeft, Loader2, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Shared chrome for every auth modal, matching the in-app modal pattern used by
 * `BuyCreditsPanel` / `WithdrawFundsModal`: portalled, gradient frame, centred
 * on desktop and a bottom sheet on phones.
 */
export function AuthModalShell({
  isOpen,
  onClose,
  onBack,
  title,
  subtitle,
  children,
  footer,
  widthClassName = 'max-w-[440px]',
}: {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  widthClassName?: string;
}) {
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="gradient-overlay fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          'brand-gradient-frame flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] p-2.5 sm:rounded-[20px] sm:p-3',
          widthClassName,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-white shadow-sm">
          <div className="flex shrink-0 items-center gap-2 border-b border-[#EFE8E3] p-3 sm:p-4">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white text-[#212121] transition-colors hover:bg-orange-50/60"
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="brand-campaign-page-title truncate">{title}</h2>
              {subtitle ? (
                <p className="brand-campaign-meta mt-0.5 text-[#616161]">{subtitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white text-[#212121] transition-colors hover:bg-orange-50/60"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">{children}</div>

          {footer ? (
            <div className="shrink-0 border-t border-[#EFE8E3] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AuthField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="brand-campaign-meta mb-1 block text-[#616161]">
        {label}
      </label>
      {children}
    </div>
  );
}

export function AuthTextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'brand-field-capsule auth-field disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    />
  );
}

/**
 * Email capsule with the gradient circular send action on the right, mirroring
 * the script composer in the AI chat flow.
 */
export function AuthEmailInput({
  id,
  value,
  onChange,
  onSend,
  canSend,
  isSending,
  disabled,
  placeholder = 'you@company.com',
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  canSend: boolean;
  isSending: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="brand-field-shell brand-field-shell--action auth-field">
      <input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
        className="brand-field-shell__input disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={!canSend || isSending}
        aria-label="Send one time password"
        title="Send OTP"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

export function AuthOtpInput({
  id,
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      placeholder="------"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
      disabled={disabled}
      autoFocus={autoFocus}
      required
      className="brand-field-capsule auth-field auth-field--otp disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

export function AuthSocialRow({
  onSelect,
  disabled,
}: {
  onSelect: (provider: 'google' | 'facebook') => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-[#EFE8E3]" aria-hidden />
      <div className="flex shrink-0 items-center gap-2">
        {(
          [
            { id: 'google', label: 'Google', icon: '/assets/icon-google.svg' },
            { id: 'facebook', label: 'Facebook', icon: '/assets/icon-facebook.svg' },
          ] as const
        ).map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => onSelect(provider.id)}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E8E2DB] bg-white px-3 py-1.5 font-heading text-[13px] font-medium text-[#212121] transition-colors hover:bg-orange-50/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Image src={provider.icon} alt="" width={16} height={16} className="h-4 w-4" />
            {provider.label}
          </button>
        ))}
      </div>
      <span className="h-px flex-1 bg-[#EFE8E3]" aria-hidden />
    </div>
  );
}

export function AuthSwitchPrompt({
  question,
  actionLabel,
  onAction,
}: {
  question: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <p className="brand-campaign-meta mt-2.5 text-center text-[#616161]">
      {question}{' '}
      <button
        type="button"
        onClick={onAction}
        className="font-heading font-semibold text-[#E86512] hover:underline"
      >
        {actionLabel}
      </button>
    </p>
  );
}
