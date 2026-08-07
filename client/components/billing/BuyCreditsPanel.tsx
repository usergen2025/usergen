'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Coins, Loader2, Sparkles, X } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import { BrandIconChip } from '@/components/brand';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: { error?: { description?: string; reason?: string } }) => void) => void;
    };
  }
}

type Audience = 'CREATOR' | 'BRAND';
type InputMode = 'AMOUNT' | 'CREDITS';

interface CreditPackage {
  id: string;
  title: string;
  description?: string | null;
  amountPaise: number;
  creditsToGrant: number;
  badge?: string | null;
}

interface BillingQuote {
  baseAmountPaise: number;
  feeAmountPaise: number;
  gstAmountPaise: number;
  totalChargePaise: number;
  creditsToGrant: number;
  gstRateBpsApplied: number;
  feeBpsApplied: number;
}

interface BuyCreditsPanelProps {
  audience: Audience;
  open?: boolean;
  onClose?: () => void;
  embedded?: boolean;
  className?: string;
  /** Where to send the user after a successful payment. Defaults to `/`. */
  successRedirectTo?: string;
  onPaymentSuccess?: (details: { creditsGranted: number; purchaseOrderId: string }) => void;
}

function paiseToRupeeLabel(paise: number) {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function extractApiError(e: any, fallback: string) {
  return (
    e?.response?.data?.message ||
    e?.response?.data?.error ||
    e?.message ||
    fallback
  );
}

async function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.Razorpay) return true;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function BuyCreditsPanel({
  audience,
  open = true,
  onClose,
  embedded = false,
  className,
  successRedirectTo = '/',
  onPaymentSuccess,
}: BuyCreditsPanelProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const paymentCompletedRef = useRef(false);

  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('AMOUNT');
  const [amountRupees, setAmountRupees] = useState('1000');
  const [creditsDesired, setCreditsDesired] = useState('950');
  const [quote, setQuote] = useState<BillingQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getBillingPackages(audience);
      const list = (res.data || []) as CreditPackage[];
      setPackages(Array.isArray(list) ? list : []);
      if (list.length > 0) {
        setSelectedPackageId(list[0].id);
        setCustomMode(false);
      } else {
        setCustomMode(true);
      }
    } catch (e: any) {
      showToast(extractApiError(e, 'Failed to load credit packages'), 'error');
    } finally {
      setLoading(false);
    }
  }, [audience, showToast]);

  useEffect(() => {
    if (open) void loadPackages();
  }, [open, loadPackages]);

  useEffect(() => {
    if (!open || embedded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, embedded, onClose]);

  const refreshQuote = useCallback(async () => {
    if (!user?.id) return;
    setQuoting(true);
    try {
      let res;
      if (!customMode && selectedPackageId) {
        res = await apiClient.quoteBilling({
          audience,
          userId: user.id,
          packageId: selectedPackageId,
        });
      } else if (inputMode === 'AMOUNT') {
        const rupees = Number(amountRupees);
        if (!Number.isFinite(rupees) || rupees <= 0) {
          setQuote(null);
          return;
        }
        res = await apiClient.quoteBilling({
          audience,
          userId: user.id,
          inputMode: 'AMOUNT',
          amountPaise: Math.round(rupees * 100),
        });
      } else {
        const credits = Number(creditsDesired);
        if (!Number.isFinite(credits) || credits <= 0) {
          setQuote(null);
          return;
        }
        res = await apiClient.quoteBilling({
          audience,
          userId: user.id,
          inputMode: 'CREDITS',
          creditsDesired: Math.floor(credits),
        });
      }
      if (res.success && res.data) {
        setQuote(res.data as BillingQuote);
      } else {
        setQuote(null);
        showToast(res.error || res.message || 'Unable to calculate quote', 'error');
      }
    } catch (e: any) {
      setQuote(null);
      showToast(extractApiError(e, 'Unable to calculate quote'), 'error');
    } finally {
      setQuoting(false);
    }
  }, [
    audience,
    user?.id,
    customMode,
    selectedPackageId,
    inputMode,
    amountRupees,
    creditsDesired,
    showToast,
  ]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      void refreshQuote();
    }, 250);
    return () => clearTimeout(t);
  }, [open, refreshQuote]);

  const breakdown = useMemo(() => {
    if (!quote) return null;
    return [
      { label: 'Top-up amount', value: `₹${paiseToRupeeLabel(quote.baseAmountPaise)}` },
      {
        label: `Platform fee (${(quote.feeBpsApplied / 100).toFixed(1)}%)`,
        value: `₹${paiseToRupeeLabel(quote.feeAmountPaise)}`,
      },
      { label: 'Credits you receive', value: quote.creditsToGrant.toLocaleString('en-IN') },
      {
        label: `GST (${(quote.gstRateBpsApplied / 100).toFixed(1)}%)`,
        value: `₹${paiseToRupeeLabel(quote.gstAmountPaise)}`,
      },
      { label: 'Total payable', value: `₹${paiseToRupeeLabel(quote.totalChargePaise)}`, strong: true },
    ];
  }, [quote]);

  const finishSuccess = useCallback(
    (creditsGranted: number, purchaseOrderId: string) => {
      showToast(`Payment successful. ${creditsGranted.toLocaleString('en-IN')} credits added.`, 'success');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('credits-refresh'));
      }
      onPaymentSuccess?.({ creditsGranted, purchaseOrderId });
      onClose?.();
      router.push(successRedirectTo);
    },
    [showToast, onPaymentSuccess, onClose, router, successRedirectTo],
  );

  const handlePay = async () => {
    if (!user?.id || !quote) return;
    setPaying(true);
    paymentCompletedRef.current = false;
    try {
      const ready = await loadRazorpayScript();
      if (!ready || !window.Razorpay) {
        throw new Error('Razorpay Checkout failed to load. Please refresh and try again.');
      }

      const buyer = {
        customerEmail: user.email || undefined,
        customerName: user.name || undefined,
      };
      const orderBody =
        !customMode && selectedPackageId
          ? { userId: user.id, audience, packageId: selectedPackageId, ...buyer }
          : inputMode === 'AMOUNT'
            ? {
                userId: user.id,
                audience,
                inputMode: 'AMOUNT' as const,
                amountPaise: Math.round(Number(amountRupees) * 100),
                ...buyer,
              }
            : {
                userId: user.id,
                audience,
                inputMode: 'CREDITS' as const,
                creditsDesired: Math.floor(Number(creditsDesired)),
                ...buyer,
              };

      const orderRes = await apiClient.createBillingCheckoutOrder(orderBody);
      const order = orderRes.data;
      if (!order?.razorpayOrderId || !order?.razorpayKeyId) {
        throw new Error(orderRes.message || orderRes.error || 'Failed to create payment order');
      }

      const rzp = new window.Razorpay({
        key: order.razorpayKeyId,
        amount: order.amountPaise,
        currency: order.currency || 'INR',
        name: 'UserGen',
        description: `${order.creditsToGrant} credits`,
        order_id: order.razorpayOrderId,
        prefill: {
          name: user.name || '',
          email: user.email || '',
        },
        notes: {
          purchaseOrderId: order.purchaseOrderId,
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          paymentCompletedRef.current = true;
          try {
            const verify = await apiClient.verifyBillingCheckout({
              userId: user.id,
              purchaseOrderId: order.purchaseOrderId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            if (!verify.success && !verify.data) {
              throw new Error(verify.message || verify.error || 'Payment verification failed');
            }
            finishSuccess(order.creditsToGrant, order.purchaseOrderId);
          } catch (err: any) {
            showToast(
              extractApiError(
                err,
                'Payment may have succeeded but verification failed. Please refresh billing in a moment.',
              ),
              'warning',
            );
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('credits-refresh'));
            }
          } finally {
            setPaying(false);
          }
        },
        modal: {
          ondismiss: () => {
            setPaying(false);
            if (!paymentCompletedRef.current) {
              showToast(
                'Payment cancelled. We emailed a link to complete it later.',
                'info',
              );
              void apiClient
                .remindBillingCheckout(order.purchaseOrderId, user.id)
                .catch(() => undefined);
            }
          },
        },
      });

      rzp.on('payment.failed', (response) => {
        paymentCompletedRef.current = true;
        setPaying(false);
        const reason =
          response?.error?.description ||
          response?.error?.reason ||
          'Payment failed. Please try another method.';
        showToast(reason, 'error');
        // Failed-payment email is sent by the Razorpay webhook path
      });

      rzp.open();
    } catch (e: any) {
      setPaying(false);
      showToast(extractApiError(e, 'Checkout failed. Please try again.'), 'error');
    }
  };

  if (!open) return null;

  const header = (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#EFE8E3] p-3 sm:p-4">
      <div className="min-w-0">
        <h3 className="brand-campaign-page-title">Add Credits</h3>
        <p className="brand-campaign-meta mt-0.5 text-[#616161]">
          Pick a pack or enter your own amount. GST is added on top.
        </p>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white text-[#212121] transition-colors hover:bg-orange-50/60"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const body = loading ? (
    <div className="brand-campaign-row flex items-center justify-center gap-2 py-10 text-[#616161]">
      <Loader2 className="h-4 w-4 animate-spin text-[#E86512]" /> Loading packages…
    </div>
  ) : (
    <div className="space-y-3">
      {/* Portrait tiles with a 2px gradient ring on select — same pattern as the video style picker */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
        {packages.map((pkg) => {
          const selected = !customMode && selectedPackageId === pkg.id;
          return (
            <button
              key={pkg.id}
              type="button"
              onClick={() => {
                setCustomMode(false);
                setSelectedPackageId(pkg.id);
              }}
              aria-pressed={selected}
              className="relative flex h-full flex-col rounded-[12px] p-[2px] transition-all"
              style={
                selected
                  ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                  : undefined
              }
            >
              <div className="flex h-full w-full min-w-0 flex-col items-center gap-1.5 rounded-[10px] bg-white p-2 shadow-[0px_1px_7px_rgba(87,73,119,0.23)]">
                <div className="flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[8px] border border-white bg-gradient-to-b from-[#FFF3EA] to-[#FFE9EC] px-1.5 py-3">
                  <BrandIconChip size="sm">
                    <Coins className="text-white" strokeWidth={1.8} />
                  </BrandIconChip>
                  <p className="font-heading text-[clamp(0.95rem,1.7vh,1.125rem)] font-semibold leading-none text-[#212121]">
                    ₹{paiseToRupeeLabel(pkg.amountPaise)}
                  </p>
                  <p className="brand-campaign-meta text-center leading-tight text-[#616161]">
                    {pkg.creditsToGrant.toLocaleString('en-IN')} credits
                  </p>
                </div>
                <span className="w-full truncate text-center font-heading text-[clamp(0.75rem,1.4vh,0.875rem)] font-medium text-[#212121]">
                  {pkg.title}
                </span>
              </div>
              {pkg.badge && (
                <span
                  className="brand-status-pill brand-status-pill--auto absolute right-1 top-1 origin-top-right scale-90 whitespace-nowrap"
                  translate="no"
                >
                  {pkg.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setCustomMode(true)}
        aria-pressed={customMode}
        className={cn(
          'brand-campaign-row flex w-full items-center gap-2 rounded-[16px] border-2 px-3 py-2.5 text-left font-heading font-medium transition-colors',
          customMode
            ? 'border-[#E86512] bg-[#FFF8F2] text-[#212121]'
            : 'border-dashed border-[#E0E0E0] text-[#616161] hover:border-[#F0B48A]',
        )}
      >
        <Sparkles className="brand-campaign-metric-stroke h-4 w-4" strokeWidth={2} aria-hidden />
        Custom amount
      </button>

      {customMode && (
        <div className="space-y-2.5 rounded-[16px] border border-[#F0E5DC] bg-[#FFFCFA] p-3">
          <div className="brand-segmented">
            <button
              type="button"
              onClick={() => setInputMode('AMOUNT')}
              aria-pressed={inputMode === 'AMOUNT'}
              className="brand-segmented__tab flex-1"
            >
              I want to pay
            </button>
            <button
              type="button"
              onClick={() => setInputMode('CREDITS')}
              aria-pressed={inputMode === 'CREDITS'}
              className="brand-segmented__tab flex-1"
            >
              I want credits
            </button>
          </div>
          <label className="block">
            <span className="brand-campaign-meta mb-1 block text-[#616161]">
              {inputMode === 'AMOUNT' ? 'Amount (₹)' : 'Credits'}
            </span>
            <input
              type="number"
              min={1}
              value={inputMode === 'AMOUNT' ? amountRupees : creditsDesired}
              onChange={(e) =>
                inputMode === 'AMOUNT'
                  ? setAmountRupees(e.target.value)
                  : setCreditsDesired(e.target.value)
              }
              className="brand-field-capsule"
            />
          </label>
        </div>
      )}

      <div className="rounded-[16px] border border-[#F0E5DC] bg-[#FFFCFA] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="brand-page-section-title">Breakdown</h4>
          {quoting && <Loader2 className="h-4 w-4 animate-spin text-[#E86512]" />}
        </div>
        {breakdown ? (
          <dl className="space-y-1.5">
            {breakdown.map((row) => (
              <div
                key={row.label}
                className={cn(
                  'brand-campaign-row flex items-center justify-between gap-3',
                  row.strong && 'mt-1 border-t border-[#F0E5DC] pt-2',
                )}
              >
                <dt className={cn('text-[#616161]', row.strong && 'font-medium text-[#212121]')}>
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    'font-heading text-[#212121]',
                    row.strong && 'font-semibold text-[#E85A1F]',
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="brand-campaign-meta text-[#616161]">
            Enter a valid amount to see the quote.
          </p>
        )}
      </div>
    </div>
  );

  const footer = (
    <div className="shrink-0 border-t border-[#EFE8E3] p-3 sm:p-4">
      <button
        type="button"
        className="brand-cta-primary w-full"
        disabled={!quote || paying || quoting}
        onClick={() => void handlePay()}
      >
        {paying ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Processing…
          </span>
        ) : quote ? (
          `Pay ₹${paiseToRupeeLabel(quote.totalChargePaise)}`
        ) : (
          'Pay'
        )}
      </button>
    </div>
  );

  if (embedded) {
    return (
      <div
        className={cn(
          'brand-gradient-frame overflow-hidden rounded-[20px] p-3 sm:p-4',
          className,
        )}
      >
        <div className="overflow-hidden rounded-[16px] bg-white shadow-sm">
          {header}
          <div className="p-3 sm:p-4">{body}</div>
          {footer}
        </div>
      </div>
    );
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center gradient-overlay p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          'brand-gradient-frame flex max-h-[92dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-[20px] p-2.5 sm:rounded-[20px] sm:p-3',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add credits"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-white shadow-sm">
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">{body}</div>
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}
