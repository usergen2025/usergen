'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Loader2, Lock, Wallet, X } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import { BrandIconChip } from '@/components/brand';

interface WithdrawFundsModalProps {
  open: boolean;
  onClose: () => void;
  availableEarnings: number;
  lockedEarnings: number;
  /** Fired after a request is accepted, so the page can refresh its summary. */
  onRequested?: () => void;
}

const MIN_WITHDRAWAL = 500;

const formatRupees = (value: number) => `₹${Math.max(0, value).toLocaleString('en-IN')}`;

export default function WithdrawFundsModal({
  open,
  onClose,
  availableEarnings,
  lockedEarnings,
  onRequested,
}: WithdrawFundsModalProps) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setAmount('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const parsedAmount = Number(amount || 0);

  const error = useMemo(() => {
    if (availableEarnings < MIN_WITHDRAWAL) {
      return `You need at least ${formatRupees(MIN_WITHDRAWAL)} available to withdraw.`;
    }
    if (!amount) return null;
    if (parsedAmount <= 0) return 'Enter an amount greater than zero.';
    if (parsedAmount < MIN_WITHDRAWAL) {
      return `Minimum withdrawal is ${formatRupees(MIN_WITHDRAWAL)}.`;
    }
    if (parsedAmount > availableEarnings) {
      return `You can withdraw up to ${formatRupees(availableEarnings)}.`;
    }
    return null;
  }, [amount, parsedAmount, availableEarnings]);

  const canSubmit = !error && parsedAmount >= MIN_WITHDRAWAL && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const response = await apiClient.requestCreatorWithdrawal(parsedAmount);
      // The service currently accepts the request but may reply that payouts are paused.
      const notice = (response?.data as { message?: string } | undefined)?.message;
      if (notice) {
        showToast(notice, 'warning');
      } else {
        showToast(
          `Withdrawal request for ${formatRupees(parsedAmount)} submitted.`,
          'success',
        );
      }
      onRequested?.();
      onClose();
    } catch (e: unknown) {
      showToast(
        e instanceof Error ? e.message : 'Failed to create withdrawal request',
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const balanceRows = [
    { label: 'Available to withdraw', value: formatRupees(availableEarnings), Icon: Wallet },
    { label: 'Locked (unlocks in 14 days)', value: formatRupees(lockedEarnings), Icon: Lock },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center gradient-overlay p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="brand-gradient-frame flex max-h-[92dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[20px] p-2.5 sm:rounded-[20px] sm:p-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Withdraw earnings"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-white shadow-sm">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#EFE8E3] p-3 sm:p-4">
            <div className="min-w-0">
              <h3 className="brand-campaign-page-title">Withdraw Earnings</h3>
              <p className="brand-campaign-meta mt-0.5 text-[#616161]">
                Payouts are settled to your registered account after review.
              </p>
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

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
            <div className="rounded-[16px] border border-[#F0E5DC] bg-[#FFFCFA] p-3">
              <dl className="space-y-2">
                {balanceRows.map((row) => (
                  <div
                    key={row.label}
                    className="brand-campaign-row flex items-center justify-between gap-3"
                  >
                    <dt className="inline-flex min-w-0 items-center gap-2 text-[#616161]">
                      <BrandIconChip size="sm">
                        <row.Icon className="text-white" strokeWidth={1.8} />
                      </BrandIconChip>
                      <span className="min-w-0">{row.label}</span>
                    </dt>
                    <dd className="font-heading font-semibold text-[#212121]">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label
                  htmlFor="withdraw-amount"
                  className="brand-campaign-meta text-[#616161]"
                >
                  Amount to withdraw (₹)
                </label>
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.floor(availableEarnings)))}
                  disabled={availableEarnings < MIN_WITHDRAWAL}
                  className="brand-campaign-meta font-medium text-[#E85A1F] transition-opacity hover:opacity-75 disabled:opacity-40"
                >
                  Withdraw all
                </button>
              </div>
              <input
                id="withdraw-amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={String(MIN_WITHDRAWAL)}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                className="brand-field-capsule w-full"
              />
              <p
                className={cn(
                  'brand-campaign-meta mt-1.5',
                  error ? 'font-medium text-[#C62828]' : 'text-[#616161]',
                )}
              >
                {error ?? `Minimum ${formatRupees(MIN_WITHDRAWAL)} per request.`}
              </p>
            </div>

            {parsedAmount > 0 && !error && (
              <div className="rounded-[16px] border border-[#F0E5DC] bg-[#FFFCFA] p-3">
                <h4 className="brand-page-section-title mb-2">Summary</h4>
                <dl className="space-y-1.5">
                  <div className="brand-campaign-row flex items-center justify-between gap-3">
                    <dt className="text-[#616161]">Requested</dt>
                    <dd className="font-heading font-semibold text-[#E85A1F]">
                      {formatRupees(parsedAmount)}
                    </dd>
                  </div>
                  <div className="brand-campaign-row flex items-center justify-between gap-3">
                    <dt className="text-[#616161]">Balance after withdrawal</dt>
                    <dd className="font-heading text-[#212121]">
                      {formatRupees(availableEarnings - parsedAmount)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <p className="brand-campaign-meta inline-flex items-start gap-1.5 text-[#616161]">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              Requests are reviewed manually and usually settle within 3–5 business days.
            </p>
          </div>

          <div className="shrink-0 border-t border-[#EFE8E3] p-3 sm:p-4">
            <button
              type="button"
              className="brand-cta-primary w-full disabled:opacity-50"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                </span>
              ) : parsedAmount > 0 && !error ? (
                `Request ${formatRupees(parsedAmount)}`
              ) : (
                'Request withdrawal'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
