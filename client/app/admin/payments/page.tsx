'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronsUpDown,
  CreditCard,
  Download,
  Link2,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast, type ToastType } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';

type TabId = 'settings' | 'packages' | 'orders' | 'links' | 'refunds';
type ShowToast = (msg: string, type?: ToastType) => void;

type RefundableOrderOption = {
  id: string;
  userId: string | null;
  userLabel: string;
  audience: string;
  status: string;
  totalChargePaise: number;
  creditsToGrant: number;
  createdAt: string;
  invoiceNumber?: string;
  remainingRefundPaise: number;
};

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'settings', label: 'Fees & GST', icon: <Settings2 className="h-4 w-4" /> },
  { id: 'packages', label: 'Packages', icon: <Package className="h-4 w-4" /> },
  { id: 'orders', label: 'Orders', icon: <CreditCard className="h-4 w-4" /> },
  { id: 'links', label: 'Payment Links', icon: <Link2 className="h-4 w-4" /> },
  { id: 'refunds', label: 'Refunds', icon: <RefreshCw className="h-4 w-4" /> },
];

function paiseToRupees(paise: number) {
  return (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value?: string | Date | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminPaymentsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabId>('settings');

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Payments</h1>
        <p className="mt-1 text-sm text-gray-400">
          Manage credit packages, platform fees, GST, orders, and admin payment links.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-700 pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-orange-500/20 text-orange-300'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && <SettingsPanel adminUserId={user?.id} showToast={showToast} />}
      {tab === 'packages' && <PackagesPanel adminUserId={user?.id} showToast={showToast} />}
      {tab === 'orders' && <OrdersPanel showToast={showToast} />}
      {tab === 'links' && <PaymentLinksPanel adminUserId={user?.id} showToast={showToast} />}
      {tab === 'refunds' && <RefundsPanel adminUserId={user?.id} showToast={showToast} />}
    </div>
  );
}

function SettingsPanel({
  adminUserId,
  showToast,
}: {
  adminUserId?: string;
  showToast: ShowToast;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    creatorFeeBps: 500,
    brandFeeBps: 1000,
    gstEnabled: true,
    gstRateBps: 1800,
    minTopUpPaise: 10000,
    maxTopUpPaise: 50000000,
    platformGstin: '',
    platformLegalName: '',
    platformAddress: '',
    invoicePrefix: 'UG',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getAdminBillingSettings();
      if (res.success && res.data) {
        const s = res.data;
        setForm({
          creatorFeeBps: s.creatorFeeBps ?? 500,
          brandFeeBps: s.brandFeeBps ?? 1000,
          gstEnabled: s.gstEnabled ?? true,
          gstRateBps: s.gstRateBps ?? 1800,
          minTopUpPaise: s.minTopUpPaise ?? 10000,
          maxTopUpPaise: s.maxTopUpPaise ?? 50000000,
          platformGstin: s.platformGstin || '',
          platformLegalName: s.platformLegalName || '',
          platformAddress: s.platformAddress || '',
          invoicePrefix: s.invoicePrefix || 'UG',
        });
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to load billing settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiClient.updateAdminBillingSettings({
        ...form,
        platformGstin: form.platformGstin || null,
        platformLegalName: form.platformLegalName || null,
        platformAddress: form.platformAddress || null,
        updatedBy: adminUserId,
      });
      if (res.success) {
        showToast('Billing settings saved', 'success');
        await load();
      } else {
        showToast(res.error || 'Failed to save settings', 'error');
      }
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 rounded-xl border border-gray-700 bg-gray-800 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">Creator fee (%)</span>
          <input
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={(form.creatorFeeBps / 100).toFixed(2)}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                creatorFeeBps: Math.round(Number(e.target.value || 0) * 100),
              }))
            }
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">Brand fee (%)</span>
          <input
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={(form.brandFeeBps / 100).toFixed(2)}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                brandFeeBps: Math.round(Number(e.target.value || 0) * 100),
              }))
            }
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">GST rate (%)</span>
          <input
            type="number"
            step="0.01"
            disabled={!form.gstEnabled}
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white disabled:opacity-50"
            value={(form.gstRateBps / 100).toFixed(2)}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                gstRateBps: Math.round(Number(e.target.value || 0) * 100),
              }))
            }
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={form.gstEnabled}
            onChange={(e) => setForm((f) => ({ ...f, gstEnabled: e.target.checked }))}
            className="rounded border-gray-600"
          />
          GST enabled
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">Min top-up (₹)</span>
          <input
            type="number"
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={form.minTopUpPaise / 100}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                minTopUpPaise: Math.round(Number(e.target.value || 0) * 100),
              }))
            }
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">Max top-up (₹)</span>
          <input
            type="number"
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={form.maxTopUpPaise / 100}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                maxTopUpPaise: Math.round(Number(e.target.value || 0) * 100),
              }))
            }
          />
        </label>
      </div>

      <div className="grid gap-4">
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">Platform GSTIN</span>
          <input
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={form.platformGstin}
            onChange={(e) => setForm((f) => ({ ...f, platformGstin: e.target.value }))}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">Legal name</span>
          <input
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={form.platformLegalName}
            onChange={(e) => setForm((f) => ({ ...f, platformLegalName: e.target.value }))}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">Address</span>
          <textarea
            rows={2}
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={form.platformAddress}
            onChange={(e) => setForm((f) => ({ ...f, platformAddress: e.target.value }))}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-400">Invoice prefix</span>
          <input
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
            value={form.invoicePrefix}
            onChange={(e) => setForm((f) => ({ ...f, invoicePrefix: e.target.value }))}
          />
        </label>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save settings
      </button>
    </div>
  );
}

function PackagesPanel({
  adminUserId,
  showToast,
}: {
  adminUserId?: string;
  showToast: ShowToast;
}) {
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<any[]>([]);
  const [audienceFilter, setAudienceFilter] = useState<'ALL' | 'CREATOR' | 'BRAND'>('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    audience: 'CREATOR' as 'CREATOR' | 'BRAND',
    title: '',
    description: '',
    amountRupees: 500,
    badge: '',
    sortOrder: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getAdminBillingPackages(
        audienceFilter === 'ALL' ? undefined : audienceFilter,
      );
      if (res.success && res.data) setPackages(res.data);
    } catch (e) {
      console.error(e);
      showToast('Failed to load packages', 'error');
    } finally {
      setLoading(false);
    }
  }, [audienceFilter, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!form.title.trim() || form.amountRupees <= 0) {
      showToast('Title and amount are required', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await apiClient.createAdminBillingPackage({
        audience: form.audience,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        amountPaise: Math.round(form.amountRupees * 100),
        badge: form.badge.trim() || undefined,
        sortOrder: form.sortOrder,
        updatedBy: adminUserId,
      });
      if (res.success) {
        showToast('Package created', 'success');
        setShowCreate(false);
        setForm({
          audience: 'CREATOR',
          title: '',
          description: '',
          amountRupees: 500,
          badge: '',
          sortOrder: 0,
        });
        await load();
      } else {
        showToast(res.error || 'Failed to create package', 'error');
      }
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Failed to create package', 'error');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (pkg: any) => {
    try {
      const res = await apiClient.updateAdminBillingPackage(pkg.id, {
        isActive: !pkg.isActive,
        updatedBy: adminUserId,
      });
      if (res.success) {
        showToast(pkg.isActive ? 'Package deactivated' : 'Package activated', 'success');
        await load();
      }
    } catch {
      showToast('Failed to update package', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['ALL', 'CREATOR', 'BRAND'] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAudienceFilter(a)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm',
                audienceFilter === a
                  ? 'bg-orange-500/20 text-orange-300'
                  : 'bg-gray-800 text-gray-400 hover:text-white',
              )}
            >
              {a}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
        >
          <Plus className="h-4 w-4" /> New package
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-700 text-gray-400">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Credits</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {packages.map((pkg) => (
                <tr key={pkg.id} className="hover:bg-gray-700/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{pkg.title}</div>
                    {pkg.badge && (
                      <span className="text-xs text-orange-300">{pkg.badge}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{pkg.audience}</td>
                  <td className="px-4 py-3 text-gray-300">₹{paiseToRupees(pkg.amountPaise)}</td>
                  <td className="px-4 py-3 text-gray-300">{pkg.creditsToGrant}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        pkg.isActive
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-gray-600/40 text-gray-400',
                      )}
                    >
                      {pkg.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleActive(pkg)}
                      className="rounded-lg px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                    >
                      {pkg.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {packages.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No packages found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">New package</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Audience</span>
                <select
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.audience}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      audience: e.target.value as 'CREATOR' | 'BRAND',
                    }))
                  }
                >
                  <option value="CREATOR">CREATOR</option>
                  <option value="BRAND">BRAND</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Title</span>
                <input
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Amount (₹)</span>
                <input
                  type="number"
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.amountRupees}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amountRupees: Number(e.target.value || 0) }))
                  }
                />
                <span className="mt-1 block text-xs text-gray-500">
                  Credits are calculated from fee formula on save.
                </span>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Badge (optional)</span>
                <input
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.badge}
                  onChange={(e) => setForm((f) => ({ ...f, badge: e.target.value }))}
                />
              </label>
              <button
                onClick={create}
                disabled={creating}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrdersPanel({
  showToast,
}: {
  showToast: ShowToast;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [audience, setAudience] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.listAdminBillingOrders({
        status: status || undefined,
        audience: audience || undefined,
        take: 50,
      });
      if (res.success && res.data) {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to load orders', 'error');
    } finally {
      setLoading(false);
    }
  }, [status, audience, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await apiClient.exportAdminBillingOrdersCsv({
        status: status || undefined,
        audience: audience || undefined,
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'billing-orders.csv';
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV downloaded', 'success');
    } catch {
      showToast('Failed to export CSV', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="DRAFT">DRAFT</option>
          <option value="AWAITING_PAYMENT">AWAITING_PAYMENT</option>
          <option value="PAID">PAID</option>
          <option value="FULFILLED">FULFILLED</option>
          <option value="FAILED">FAILED</option>
          <option value="EXPIRED">EXPIRED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="REFUND_PENDING">REFUND_PENDING</option>
          <option value="REFUNDED">REFUNDED</option>
          <option value="PARTIALLY_REFUNDED">PARTIALLY_REFUNDED</option>
        </select>
        <select
          className="rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          <option value="">All audiences</option>
          <option value="CREATOR">CREATOR</option>
          <option value="BRAND">BRAND</option>
        </select>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
        <button
          onClick={exportCsv}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-sm text-white hover:bg-orange-600 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </button>
        <span className="ml-auto text-sm text-gray-400">{total} orders</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-gray-700 text-gray-400">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Charge</th>
                <th className="px-4 py-3">Credits</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {items.map((o) => (
                <tr key={o.id} className="hover:bg-gray-700/40">
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">{o.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    <div className="text-white">{o.audience}</div>
                    <div className="font-mono text-xs text-gray-500">{o.userId?.slice(0, 10)}…</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{o.status}</td>
                  <td className="px-4 py-3 text-gray-300">₹{paiseToRupees(o.totalChargePaise)}</td>
                  <td className="px-4 py-3 text-gray-300">{o.creditsToGrant}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {o.invoices?.[0]?.invoiceNumber || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No orders yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PaymentLinksPanel({
  adminUserId,
  showToast,
}: {
  adminUserId?: string;
  showToast: ShowToast;
}) {
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    userId: '',
    audience: 'CREATOR' as 'CREATOR' | 'BRAND',
    amountRupees: 1000,
    customerEmail: '',
    customerName: '',
    customerPhone: '',
    description: '',
    notifyEmail: true,
    expireInHours: 72,
    feeBpsOverride: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.listAdminPaymentLinks(50);
      if (res.success && res.data) setLinks(res.data);
    } catch (e) {
      console.error(e);
      showToast('Failed to load payment links', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!adminUserId) {
      showToast('Sign in as admin to create links', 'error');
      return;
    }
    if (!form.userId.trim() || form.amountRupees <= 0) {
      showToast('User ID and amount are required', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await apiClient.createAdminPaymentLink({
        userId: form.userId.trim(),
        audience: form.audience,
        adminUserId,
        amountPaise: Math.round(form.amountRupees * 100),
        customerEmail: form.customerEmail.trim() || undefined,
        customerName: form.customerName.trim() || undefined,
        customerPhone: form.customerPhone.trim() || undefined,
        description: form.description.trim() || undefined,
        notifyEmail: form.notifyEmail,
        expireInHours: form.expireInHours,
        feeBpsOverride: form.feeBpsOverride
          ? Math.round(Number(form.feeBpsOverride) * 100)
          : undefined,
      });
      if (res.success && res.data) {
        if (res.data.shortUrl) {
          try {
            await navigator.clipboard.writeText(res.data.shortUrl);
            showToast('Payment link created and copied to clipboard', 'success');
          } catch {
            showToast('Payment link created', 'success');
          }
        } else {
          showToast('Payment link created', 'success');
        }
        setShowCreate(false);
        await load();
      } else {
        showToast(res.error || 'Failed to create link', 'error');
      }
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Failed to create link', 'error');
    } finally {
      setCreating(false);
    }
  };

  const notify = async (id: string) => {
    try {
      const res = await apiClient.notifyAdminPaymentLink(id, 'email');
      if (res.success) showToast('Notification sent', 'success');
      else showToast(res.error || 'Notify failed', 'error');
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Notify failed', 'error');
    }
  };

  const cancel = async (id: string) => {
    try {
      const res = await apiClient.cancelAdminPaymentLink(id);
      if (res.success) {
        showToast('Payment link cancelled', 'success');
        await load();
      } else showToast(res.error || 'Cancel failed', 'error');
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Cancel failed', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
        >
          <Plus className="h-4 w-4" /> Create payment link
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-gray-700 text-gray-400">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Link</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {links.map((link) => {
                const order = link.purchaseOrder;
                const cancelled = !!link.cancelledAt;
                return (
                  <tr key={link.id} className="hover:bg-gray-700/40">
                    <td className="px-4 py-3">
                      <div className="text-white">{link.customerName || link.customerEmail || '—'}</div>
                      <div className="text-xs text-gray-500">{link.customerEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      ₹{paiseToRupees(order?.totalChargePaise || 0)}
                      <div className="text-xs text-gray-500">{order?.creditsToGrant} credits</div>
                    </td>
                    <td className="px-4 py-3">
                      {link.shortUrl ? (
                        <a
                          href={link.shortUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-orange-300 hover:underline"
                        >
                          Open link
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(link.expireBy)}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {cancelled ? 'CANCELLED' : order?.status || '—'}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {!cancelled && (
                        <>
                          <button
                            onClick={() => notify(link.id)}
                            className="rounded-lg px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                          >
                            Notify
                          </button>
                          <button
                            onClick={() => cancel(link.id)}
                            className="rounded-lg px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {links.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No payment links yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-800 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Create payment link</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Existing user ID</span>
                <input
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 font-mono text-sm text-white"
                  value={form.userId}
                  onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
                  placeholder="uuid"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-gray-400">Audience</span>
                  <select
                    className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                    value={form.audience}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        audience: e.target.value as 'CREATOR' | 'BRAND',
                      }))
                    }
                  >
                    <option value="CREATOR">CREATOR</option>
                    <option value="BRAND">BRAND</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-gray-400">Amount (₹)</span>
                  <input
                    type="number"
                    className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                    value={form.amountRupees}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amountRupees: Number(e.target.value || 0) }))
                    }
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Customer email</span>
                <input
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.customerEmail}
                  onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Customer name</span>
                <input
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.customerName}
                  onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Fee override % (optional)</span>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.feeBpsOverride}
                  onChange={(e) => setForm((f) => ({ ...f, feeBpsOverride: e.target.value }))}
                  placeholder="e.g. 2.5"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.notifyEmail}
                  onChange={(e) => setForm((f) => ({ ...f, notifyEmail: e.target.checked }))}
                />
                Email notify via Razorpay
              </label>
              <button
                onClick={create}
                disabled={creating}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Create link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RefundsPanel({
  adminUserId,
  showToast,
}: {
  adminUserId?: string;
  showToast: ShowToast;
}) {
  const [loading, setLoading] = useState(true);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [recon, setRecon] = useState<any | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [orderOptions, setOrderOptions] = useState<RefundableOrderOption[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<RefundableOrderOption | null>(null);
  const [form, setForm] = useState({
    amountRupees: '',
    reason: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.listAdminBillingRefunds(50);
      if (res.success && res.data) setRefunds(res.data);
    } catch (e) {
      console.error(e);
      showToast('Failed to load refunds', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const loadRefundableOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await apiClient.listAdminBillingOrders({
        statuses: 'FULFILLED,PARTIALLY_REFUNDED,PAID',
        take: 100,
      });
      const items = res.data?.items || [];
      const userIds = [...new Set(items.map((o: any) => o.userId).filter(Boolean))];
      let userMap: Record<string, { email: string; name: string | null }> = {};
      if (userIds.length) {
        try {
          const usersRes = await apiClient.getAdminUsersByIds(userIds);
          const users = usersRes.data || [];
          userMap = Object.fromEntries(
            users.map((u) => [u.id, { email: u.email, name: u.name }]),
          );
        } catch {
          /* enrichment optional */
        }
      }

      const mapped: RefundableOrderOption[] = items.map((o: any) => {
        const alreadyRefunded = (o.refunds || [])
          .filter((r: any) => r.status === 'PROCESSED' || r.status === 'PENDING')
          .reduce((sum: number, r: any) => sum + (r.amountPaise || 0), 0);
        const remaining = Math.max(0, (o.totalChargePaise || 0) - alreadyRefunded);
        const u = o.userId ? userMap[o.userId] : null;
        const buyerEmail = (o.quoteSnapshot as any)?.buyerEmail;
        const userLabel =
          u?.email ||
          buyerEmail ||
          (o.userId ? `${o.userId.slice(0, 10)}…` : 'Unknown user');
        return {
          id: o.id,
          userId: o.userId,
          userLabel: u?.name ? `${u.name} (${userLabel})` : userLabel,
          audience: o.audience,
          status: o.status,
          totalChargePaise: o.totalChargePaise,
          creditsToGrant: o.creditsToGrant,
          createdAt: o.createdAt,
          invoiceNumber: o.invoices?.[0]?.invoiceNumber,
          remainingRefundPaise: remaining,
        };
      }).filter((o) => o.remainingRefundPaise > 0);

      setOrderOptions(mapped);
    } catch (e) {
      console.error(e);
      showToast('Failed to load refundable orders', 'error');
    } finally {
      setOrdersLoading(false);
    }
  }, [showToast]);

  const openCreate = async () => {
    setShowCreate(true);
    setSelectedOrder(null);
    setOrderSearch('');
    setPickerOpen(false);
    setForm({ amountRupees: '', reason: '' });
    await loadRefundableOrders();
  };

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return orderOptions;
    return orderOptions.filter((o) => {
      const hay = [
        o.id,
        o.userId || '',
        o.userLabel,
        o.audience,
        o.status,
        o.invoiceNumber || '',
        String(o.totalChargePaise / 100),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orderOptions, orderSearch]);

  const runRecon = async () => {
    setReconLoading(true);
    try {
      const res = await apiClient.getAdminBillingReconciliation(50);
      if (res.success) setRecon(res.data);
      else showToast(res.error || 'Reconciliation failed', 'error');
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Reconciliation failed', 'error');
    } finally {
      setReconLoading(false);
    }
  };

  const create = async () => {
    if (!adminUserId) {
      showToast('Sign in as admin to refund', 'error');
      return;
    }
    if (!selectedOrder) {
      showToast('Select a purchase order to refund', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await apiClient.createAdminBillingRefund({
        purchaseOrderId: selectedOrder.id,
        adminUserId,
        amountPaise: form.amountRupees
          ? Math.round(Number(form.amountRupees) * 100)
          : undefined,
        reason: form.reason.trim() || undefined,
      });
      if (res.success) {
        showToast(
          `Refund processed. Clawed ${res.data?.clawback?.clawedBack ?? 0} credits` +
            (res.data?.clawback?.shortfall
              ? ` (shortfall ${res.data.clawback.shortfall})`
              : ''),
          'success',
        );
        setShowCreate(false);
        setSelectedOrder(null);
        setForm({ amountRupees: '', reason: '' });
        await load();
      } else {
        showToast(res.error || 'Refund failed', 'error');
      }
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Refund failed', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
        >
          <Plus className="h-4 w-4" /> Issue refund
        </button>
        <button
          onClick={runRecon}
          disabled={reconLoading}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600 disabled:opacity-50"
        >
          {reconLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Run reconciliation
        </button>
      </div>

      {recon && (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 text-sm">
          <p className="text-white">
            Scanned {recon.scanned}, matched {recon.matched}, issues {recon.issueCount}
          </p>
          {recon.issues?.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-300">
              {recon.issues.slice(0, 20).map((issue: any, idx: number) => (
                <li key={idx}>
                  [{issue.severity}] {issue.code}: {issue.message} ({issue.orderId?.slice(0, 8)}…)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-gray-700 text-gray-400">
              <tr>
                <th className="px-4 py-3">Refund</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Clawback</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {refunds.map((r) => (
                <tr key={r.id} className="hover:bg-gray-700/40">
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">{r.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {r.purchaseOrderId?.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-gray-300">₹{paiseToRupees(r.amountPaise)}</td>
                  <td className="px-4 py-3 text-gray-300">
                    {r.creditsClawedBack}/{r.creditsToClawBack}
                    {r.shortfallCredits > 0 && (
                      <span className="ml-1 text-amber-300">(-{r.shortfallCredits} short)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{r.status}</td>
                  <td className="px-4 py-3 text-gray-400">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
              {refunds.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No refunds yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-800 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Issue refund</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="block text-sm">
                <span className="mb-1 block text-gray-400">Purchase order</span>
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-left text-sm text-white"
                >
                  <span className={selectedOrder ? 'text-white' : 'text-gray-500'}>
                    {selectedOrder
                      ? `${selectedOrder.id.slice(0, 10)}… · ${selectedOrder.userLabel}`
                      : 'Search and select an order'}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 text-gray-400" />
                </button>

                {pickerOpen && (
                  <div className="mt-2 overflow-hidden rounded-lg border border-gray-600 bg-gray-900">
                    <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
                      <Search className="h-4 w-4 text-gray-500" />
                      <input
                        autoFocus
                        className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                        placeholder="Search by id, user, invoice, amount…"
                        value={orderSearch}
                        onChange={(e) => setOrderSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {ordersLoading ? (
                        <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-400">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading orders…
                        </div>
                      ) : filteredOrders.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-500">
                          No refundable orders found
                        </div>
                      ) : (
                        filteredOrders.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => {
                              setSelectedOrder(o);
                              setForm((f) => ({
                                ...f,
                                amountRupees: String(o.remainingRefundPaise / 100),
                              }));
                              setPickerOpen(false);
                              setOrderSearch('');
                            }}
                            className={cn(
                              'block w-full border-b border-gray-800 px-3 py-2.5 text-left hover:bg-gray-800',
                              selectedOrder?.id === o.id && 'bg-orange-500/10',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-orange-300">
                                {o.id.slice(0, 12)}…
                              </span>
                              <span className="text-xs text-gray-400">{o.status}</span>
                            </div>
                            <div className="mt-0.5 text-sm text-white">{o.userLabel}</div>
                            <div className="mt-0.5 text-xs text-gray-400">
                              {formatDate(o.createdAt)} · ₹{paiseToRupees(o.totalChargePaise)} ·{' '}
                              {o.creditsToGrant} credits
                              {o.invoiceNumber ? ` · ${o.invoiceNumber}` : ''}
                              {o.remainingRefundPaise < o.totalChargePaise
                                ? ` · remaining ₹${paiseToRupees(o.remainingRefundPaise)}`
                                : ''}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {selectedOrder && (
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs text-gray-300">
                  <div>
                    <span className="text-gray-500">User:</span> {selectedOrder.userLabel}
                  </div>
                  <div>
                    <span className="text-gray-500">Charged:</span> ₹
                    {paiseToRupees(selectedOrder.totalChargePaise)} ·{' '}
                    <span className="text-gray-500">Refundable:</span> ₹
                    {paiseToRupees(selectedOrder.remainingRefundPaise)}
                  </div>
                  <div>
                    <span className="text-gray-500">Date:</span>{' '}
                    {formatDate(selectedOrder.createdAt)}
                    {selectedOrder.invoiceNumber
                      ? ` · Invoice ${selectedOrder.invoiceNumber}`
                      : ''}
                  </div>
                </div>
              )}

              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">
                  Amount ₹ (blank = full remaining)
                </span>
                <input
                  type="number"
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.amountRupees}
                  onChange={(e) => setForm((f) => ({ ...f, amountRupees: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">Reason</span>
                <textarea
                  rows={2}
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </label>
              <button
                onClick={create}
                disabled={creating || !selectedOrder}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refund + clawback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
