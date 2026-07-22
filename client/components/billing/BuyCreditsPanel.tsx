'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IndianRupee, Loader2, X } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import Button from '@/components/ui/Button';

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

  const panel = (
    <div
      className={cn(
        'rounded-2xl border border-orange-100 bg-white shadow-sm',
        embedded ? 'p-4 sm:p-5' : 'p-5 sm:p-6',
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Buy credits</h3>
          <p className="text-sm text-gray-500">
            Choose a package or enter a custom amount. GST is added on top of the top-up.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading packages…
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
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
                  className={cn(
                    'rounded-xl border p-4 text-left transition',
                    selected
                      ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500'
                      : 'border-gray-200 hover:border-orange-300',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900">{pkg.title}</span>
                    {pkg.badge && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-orange-700">
                        {pkg.badge}
                      </span>
                    )}
                  </div>
                  <p className="flex items-center gap-0.5 text-sm text-gray-700">
                    <IndianRupee className="h-3.5 w-3.5" />
                    {paiseToRupeeLabel(pkg.amountPaise)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {pkg.creditsToGrant.toLocaleString('en-IN')} credits
                  </p>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setCustomMode(true)}
            className={cn(
              'mb-4 w-full rounded-xl border px-4 py-3 text-left text-sm transition',
              customMode
                ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500'
                : 'border-dashed border-gray-300 hover:border-orange-300',
            )}
          >
            Custom amount
          </button>

          {customMode && (
            <div className="mb-4 space-y-3 rounded-xl bg-gray-50 p-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setInputMode('AMOUNT')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium',
                    inputMode === 'AMOUNT' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600',
                  )}
                >
                  I want to pay
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('CREDITS')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium',
                    inputMode === 'CREDITS' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600',
                  )}
                >
                  I want credits
                </button>
              </div>
              {inputMode === 'AMOUNT' ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-gray-600">Amount (₹)</span>
                  <input
                    type="number"
                    min={1}
                    value={amountRupees}
                    onChange={(e) => setAmountRupees(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </label>
              ) : (
                <label className="block text-sm">
                  <span className="mb-1 block text-gray-600">Credits</span>
                  <input
                    type="number"
                    min={1}
                    value={creditsDesired}
                    onChange={(e) => setCreditsDesired(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </label>
              )}
            </div>
          )}

          <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-800">Breakdown</h4>
              {quoting && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>
            {breakdown ? (
              <dl className="space-y-2">
                {breakdown.map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-sm">
                    <dt className={cn(row.strong ? 'font-semibold text-gray-900' : 'text-gray-600')}>
                      {row.label}
                    </dt>
                    <dd className={cn(row.strong ? 'font-semibold text-orange-600' : 'text-gray-800')}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Enter a valid amount to see the quote.</p>
            )}
          </div>

          <Button
            variant="primary"
            className="w-full"
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
          </Button>
        </>
      )}
    </div>
  );

  if (embedded) return panel;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto">{panel}</div>
    </div>
  );
}
