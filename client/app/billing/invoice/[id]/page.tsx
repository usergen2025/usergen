'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { ArrowLeft, Download, Loader2, Printer } from 'lucide-react';

function paiseToInr(paise: number) {
  return (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function BillingInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const id = String(params?.id || '');
  const [invoice, setInvoice] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !user?.id) {
      setLoading(false);
      setError('Please sign in to view this invoice');
      return;
    }
    if (!id) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiClient.getBillingInvoice(id);
        if (!res.success || !res.data) {
          throw new Error(res.error || res.message || 'Invoice not found');
        }
        if (!cancelled) setInvoice(res.data);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.response?.data?.message || e?.message || 'Failed to load invoice');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user?.id, id]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F5] text-gray-600 gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading invoice…
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF8F5] gap-3 p-6">
        <p className="text-gray-700">{error || 'Invoice not found'}</p>
        <button
          onClick={() => router.push('/billing')}
          className="text-sm text-orange-600 hover:underline"
        >
          Back to billing
        </button>
      </div>
    );
  }

  const issued = new Date(invoice.issuedAt || invoice.createdAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-[#FAF8F5] print:bg-white">
      <div className="mx-auto max-w-3xl px-4 py-6 print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <button
            onClick={() => router.push('/billing')}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" /> Back to billing
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Download className="h-4 w-4" /> Save as PDF
            </button>
          </div>
        </div>

        <article className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
          <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-orange-600">
                Tax invoice
              </p>
              <h1 className="mt-1 text-2xl font-bold text-gray-900">
                {invoice.platformLegalName || 'UserGen'}
              </h1>
              {invoice.platformGstin && (
                <p className="mt-1 text-sm text-gray-500">GSTIN: {invoice.platformGstin}</p>
              )}
            </div>
            <div className="text-right text-sm text-gray-600">
              <p className="font-semibold text-gray-900">{invoice.invoiceNumber}</p>
              <p>Date: {issued}</p>
              <p className="mt-2 inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                PAID
              </p>
            </div>
          </header>

          <section className="mb-8 grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-400">Bill to</p>
              <p className="mt-1 text-gray-800">{user?.name || user?.email || 'Customer'}</p>
              {user?.email && <p className="text-gray-500">{user.email}</p>}
              {invoice.buyerGstin && (
                <p className="text-gray-500">Buyer GSTIN: {invoice.buyerGstin}</p>
              )}
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-semibold uppercase text-gray-400">Payment</p>
              <p className="mt-1 text-gray-800">Credit top-up</p>
              <p className="text-gray-500">
                {invoice.creditsGranted?.toLocaleString('en-IN')} credits granted
              </p>
              <p className="text-gray-500">Currency: {invoice.currency || 'INR'}</p>
            </div>
          </section>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="text-gray-800">
              <tr className="border-b border-gray-100">
                <td className="py-3">
                  Credit top-up
                  <span className="block text-xs text-gray-400">
                    Platform fee ₹{paiseToInr(invoice.feeAmountPaise)} (informational)
                  </span>
                </td>
                <td className="py-3 text-right">{paiseToInr(invoice.baseAmountPaise)}</td>
              </tr>
              {invoice.discountAmountPaise > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="py-3">Discount</td>
                  <td className="py-3 text-right">−{paiseToInr(invoice.discountAmountPaise)}</td>
                </tr>
              )}
              <tr className="border-b border-gray-100">
                <td className="py-3">
                  GST ({((invoice.gstRateBps || 0) / 100).toFixed(2)}%)
                </td>
                <td className="py-3 text-right">{paiseToInr(invoice.gstAmountPaise)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-4 text-base font-semibold text-gray-900">Total paid</td>
                <td className="pt-4 text-right text-base font-semibold text-gray-900">
                  ₹{paiseToInr(invoice.totalChargePaise)}
                </td>
              </tr>
            </tfoot>
          </table>

          <p className="mt-10 text-xs text-gray-400">
            This is a computer-generated invoice for a payment already received. No amount is due.
          </p>
        </article>
      </div>
    </div>
  );
}
