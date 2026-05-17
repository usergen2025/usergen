'use client';

import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Trophy, Sparkles, Users, Pencil, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { TierLeaderboard } from '@/components/campaigns/TierLeaderboard';
import {
  PrizePoolConfig,
  PrizePoolTemplateKey,
  PrizePoolTier,
  PRIZE_POOL_TEMPLATES,
  PREVIEW_N_STOPS,
  allocatePoolPaise,
  groupAllocationByTier,
  isTiersValid,
  rupeesIN,
  rupeesToPaise,
  snapPreviewN,
  tiersForTemplate,
  totalBps,
} from '@/lib/campaigns/prize-pool';

interface PrizePoolEditorProps {
  value: PrizePoolConfig;
  onChange: (next: PrizePoolConfig) => void;
  totalBudget: number;
  previewN: number;
  onPreviewNChange: (n: number) => void;
  disabled?: boolean;
  showValidation?: boolean;
}

const TEMPLATE_ICONS: Record<Exclude<PrizePoolTemplateKey, 'CUSTOM'>, ReactElement> = {
  WINNER_HEAVY: <Trophy className="h-4 w-4" />,
  BALANCED: <Sparkles className="h-4 w-4" />,
  WIDE_REACH: <Users className="h-4 w-4" />,
};

export function PrizePoolEditor({
  value,
  onChange,
  totalBudget,
  previewN,
  onPreviewNChange,
  disabled,
  showValidation,
}: PrizePoolEditorProps) {
  const [draftTiers, setDraftTiers] = useState<PrizePoolTier[]>(value.tiers);

  useEffect(() => {
    setDraftTiers(value.tiers);
  }, [value.tiers]);

  const tiersValidation = useMemo(() => isTiersValid(value.tiers), [value.tiers]);
  const totalPoolPaise = useMemo(() => rupeesToPaise(totalBudget), [totalBudget]);
  const snappedN = snapPreviewN(previewN);
  const allocation = useMemo(
    () => allocatePoolPaise(value.tiers, Math.max(1, snappedN), totalPoolPaise),
    [value.tiers, snappedN, totalPoolPaise],
  );
  const tierGroups = useMemo(
    () => groupAllocationByTier(allocation, value.tiers),
    [allocation, value.tiers],
  );

  const setTemplate = (key: PrizePoolTemplateKey) => {
    if (disabled) return;
    if (key === 'CUSTOM') {
      onChange({ ...value, templateKey: 'CUSTOM', tiers: draftTiers.length ? draftTiers : value.tiers });
      return;
    }
    const tiers = tiersForTemplate(key);
    onChange({ ...value, templateKey: key, tiers });
    setDraftTiers(tiers);
  };

  const updateTierBps = (idx: number, bps: number) => {
    if (disabled) return;
    const next = value.tiers.map((t, i) => (i === idx ? { ...t, bps: Math.max(0, Math.round(bps)) } : t));
    onChange({ ...value, templateKey: 'CUSTOM', tiers: next });
    setDraftTiers(next);
  };

  const draftValidation = useMemo(() => isTiersValid(draftTiers), [draftTiers]);

  return (
    <div className="space-y-4">
      <div>
        <p className="font-heading text-[clamp(13px,1.5vh,15px)] font-medium text-[#212121]">
          Prize pool template
        </p>
        <p className="text-xs text-text-secondary">
          Top 3 ranks always receive individual prizes. Tail tiers scale automatically to the number of
          approved creators.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.values(PRIZE_POOL_TEMPLATES)).map((tmpl) => {
            const active = value.templateKey === tmpl.key;
            return (
              <button
                key={tmpl.key}
                type="button"
                disabled={disabled}
                onClick={() => setTemplate(tmpl.key)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors disabled:opacity-60',
                  active
                    ? 'border-[#E86412] bg-[#FFF1E6] shadow-sm'
                    : 'border-[#E8E2DB] bg-white hover:border-[#E86412]',
                )}
              >
                <span className={cn('flex items-center gap-2 text-sm font-medium', active ? 'text-[#9A460C]' : 'text-[#212121]')}>
                  {TEMPLATE_ICONS[tmpl.key]}
                  {tmpl.label}
                </span>
                <span className="text-xs text-text-secondary">{tmpl.description}</span>
              </button>
            );
          })}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setTemplate('CUSTOM')}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors disabled:opacity-60',
              value.templateKey === 'CUSTOM'
                ? 'border-[#E86412] bg-[#FFF1E6] shadow-sm'
                : 'border-dashed border-[#E8E2DB] bg-white hover:border-[#E86412]',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-[#212121]">
              <Pencil className="h-4 w-4" /> Custom
            </span>
            <span className="text-xs text-text-secondary">Edit tier bps. Locked after publish.</span>
          </button>
        </div>
      </div>

      {value.templateKey === 'CUSTOM' && !disabled && (
        <div className="rounded-xl border border-[#E8E2DB] bg-white p-3">
          <p className="font-heading text-sm font-medium text-[#212121]">Custom tier splits (bps)</p>
          <div className="mt-2 space-y-2">
            {value.tiers.map((tier, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg border border-[#F0E9E2] bg-[#FFFCF7] px-3 py-2">
                <span className="w-28 shrink-0 text-sm text-[#212121]">{tier.label || `Tier ${idx + 1}`}</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={tier.bps}
                  onChange={(e) => updateTierBps(idx, Number(e.target.value))}
                  className="w-24 rounded border border-[#E8E2DB] bg-white px-2 py-1 text-sm"
                />
                <span className="text-xs text-text-secondary">{(tier.bps / 100).toFixed(2)}% of pool</span>
              </div>
            ))}
          </div>
          <p className={cn('mt-2 text-xs', !draftValidation.ok && 'text-red-600', draftValidation.ok && 'text-text-secondary')}>
            {draftValidation.ok ? `Total: ${totalBps(value.tiers) / 100}%` : draftValidation.error}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-[#E8E2DB] bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-heading text-sm font-medium text-[#212121]">Pool preview</p>
          <span className="text-xs text-text-secondary">
            ₹{rupeesIN(totalBudget)} pool · {snappedN.toLocaleString('en-IN')} creators
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {[10, 100, 1000].map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => onPreviewNChange(preset)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                snappedN === preset
                  ? 'border-[#E86412] bg-[#FFF1E6] text-[#9A460C]'
                  : 'border-[#E8E2DB] text-text-secondary hover:border-[#E86412]',
              )}
            >
              {preset}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={PREVIEW_N_STOPS.length - 1}
          value={Math.max(0, PREVIEW_N_STOPS.findIndex((stop) => stop === snappedN))}
          onChange={(e) => {
            const stop = PREVIEW_N_STOPS[Number(e.target.value)];
            if (stop !== undefined) onPreviewNChange(stop);
          }}
          disabled={disabled}
          className="mt-2 w-full accent-[#E86512]"
        />
        <p className="mt-1 text-[11px] text-text-secondary">
          Drag to preview how the pool splits at different creator counts.
        </p>
        <div className="mt-3">
          <TierLeaderboard
            tiers={value.tiers}
            tierGroups={tierGroups}
            totalPoolRupees={totalBudget}
            participants={snappedN}
          />
        </div>
      </div>

      {showValidation && !tiersValidation.ok && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <AlertCircle className="h-4 w-4" /> {tiersValidation.error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs text-text-secondary">Min views to qualify</label>
          <input
            type="number"
            min={0}
            value={value.minViewsToQualify ?? 0}
            onChange={(e) => onChange({ ...value, minViewsToQualify: Math.max(0, Number(e.target.value) || 0) })}
            disabled={disabled}
            className="mt-1 w-full rounded border border-[#E8E2DB] bg-white px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary">Grace period (hours)</label>
          <input
            type="number"
            min={0}
            value={value.gracePeriodHours ?? 24}
            onChange={(e) => onChange({ ...value, gracePeriodHours: Math.max(0, Number(e.target.value) || 0) })}
            disabled={disabled}
            className="mt-1 w-full rounded border border-[#E8E2DB] bg-white px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary">Tie-breaker</label>
          <select
            value={value.tieBreaker || 'EARLIER_VERIFIED_POST'}
            onChange={(e) => onChange({ ...value, tieBreaker: e.target.value })}
            disabled={disabled}
            className="mt-1 w-full rounded border border-[#E8E2DB] bg-white px-2 py-1 text-sm"
          >
            <option value="EARLIER_VERIFIED_POST">Earlier verified post wins ties</option>
          </select>
        </div>
      </div>
    </div>
  );
}

