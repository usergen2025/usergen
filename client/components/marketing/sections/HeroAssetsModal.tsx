'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, X } from 'lucide-react';
import type { HeroAssetDraft } from '@/lib/marketing/generation-intent';

const MAX_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
const PRODUCT_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

/**
 * Same attachment model as the AI chat "Add Assets" step: one logo, product
 * images, and an optional company URL. The shell matches the other app
 * dialogs (gradient frame, white panel, pill fields, full-width orange button).
 * Files stay local until the funnel uploads them after a project exists.
 */
export default function HeroAssetsModal({
  open,
  initial,
  onClose,
  onAttach,
}: {
  open: boolean;
  initial: HeroAssetDraft[];
  onClose: () => void;
  onAttach: (assets: HeroAssetDraft[]) => void;
}) {
  const [logo, setLogo] = useState<HeroAssetDraft | null>(null);
  const [products, setProducts] = useState<HeroAssetDraft[]>([]);
  const [companyUrl, setCompanyUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLogo(initial.find((asset) => asset.kind === 'logo') ?? null);
    setProducts(initial.filter((asset) => asset.kind === 'product'));
    setCompanyUrl(initial.find((asset) => asset.kind === 'url')?.url ?? '');
    setError(null);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const hasAssets = logo !== null || products.length > 0 || companyUrl.trim().length > 0;

  const onLogo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setError('Please select a PNG, JPG, or SVG logo.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Logo must be under 5MB.');
      return;
    }
    setError(null);
    setLogo({
      id: `logo-${Date.now()}`,
      name: file.name,
      kind: 'logo',
      file,
      preview: URL.createObjectURL(file),
    });
  };

  const onProducts = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const valid = files.filter(
      (file) => PRODUCT_TYPES.includes(file.type) && file.size <= MAX_BYTES,
    );
    if (valid.length !== files.length) {
      setError('Only PNG or JPG product images under 5MB are kept.');
    } else {
      setError(null);
    }
    if (valid.length === 0) return;
    setProducts((current) => [
      ...current,
      ...valid.map((file, index) => ({
        id: `product-${Date.now()}-${index}`,
        name: file.name,
        kind: 'product' as const,
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
  };

  const attach = () => {
    const next: HeroAssetDraft[] = [];
    if (logo) next.push(logo);
    next.push(...products);
    const trimmed = companyUrl.trim();
    if (trimmed) {
      next.push({
        id: `url-${Date.now()}`,
        name: trimmed,
        kind: 'url',
        url: trimmed,
      });
    }
    onAttach(next);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center gradient-overlay p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="brand-gradient-frame flex max-h-[92dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[20px] p-2.5 sm:rounded-[20px] sm:p-3"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hero-assets-title"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-white shadow-sm">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#EFE8E3] p-3 sm:p-4">
            <div className="min-w-0">
              <h3 id="hero-assets-title" className="brand-campaign-page-title">
                Add assets
              </h3>
              <p className="brand-campaign-meta mt-0.5 text-[#616161]">
                Add a logo, product images, or a link.
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
            <div>
              <span className="brand-campaign-meta mb-1 block text-[#616161]">Logo</span>
              <div className="brand-field-shell gap-2">
                {logo ? (
                  <>
                    {logo.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo.preview} alt="" className="size-6 shrink-0 rounded object-cover" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate font-heading text-sm text-[#212121]">{logo.name}</span>
                    <button type="button" onClick={() => setLogo(null)} aria-label="Remove logo" className="shrink-0">
                      <X className="size-4 text-[#212121]" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="min-w-0 flex-1 text-left font-heading text-sm text-[#9e9e9e]"
                    >
                      Attach logo
                    </button>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/svg+xml"
                      onChange={onLogo}
                      className="hidden"
                    />
                    <button type="button" onClick={() => logoInputRef.current?.click()} aria-label="Attach logo">
                      <Paperclip className="size-4 text-[#616161]" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div>
              <span className="brand-campaign-meta mb-1 block text-[#616161]">Product images</span>
              <div className="brand-field-shell min-h-10 flex-wrap gap-2 py-1.5">
                {products.slice(0, 3).map((asset) => (
                  <span
                    key={asset.id}
                    className="inline-flex max-w-[140px] items-center gap-1.5 rounded-full bg-[#F7F1EC] px-2 py-0.5"
                  >
                    {asset.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.preview} alt="" className="size-4 rounded-full object-cover" />
                    ) : null}
                    <span className="truncate font-heading text-xs text-[#212121]">{asset.name}</span>
                    <button
                      type="button"
                      onClick={() => setProducts((current) => current.filter((item) => item.id !== asset.id))}
                      aria-label={`Remove ${asset.name}`}
                    >
                      <X className="size-3 text-[#212121]" />
                    </button>
                  </span>
                ))}
                {products.length > 3 ? (
                  <span className="font-heading text-xs text-[#616161]">+{products.length - 3}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => productInputRef.current?.click()}
                  className="min-w-[120px] flex-1 text-left font-heading text-sm text-[#9e9e9e]"
                >
                  {products.length > 0 ? 'Add more images' : 'Attach product images'}
                </button>
                <input
                  ref={productInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  multiple
                  onChange={onProducts}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => productInputRef.current?.click()}
                  aria-label="Attach product images"
                >
                  <Paperclip className="size-4 text-[#616161]" />
                </button>
              </div>
            </div>

            <label className="block">
              <span className="brand-campaign-meta mb-1 block text-[#616161]">Link</span>
              <input
                type="url"
                value={companyUrl}
                onChange={(event) => setCompanyUrl(event.target.value)}
                placeholder="https://www.companywebsite.com"
                className="brand-field-capsule"
              />
            </label>

            {error ? <p className="font-heading text-sm text-[#F12A4C]">{error}</p> : null}
          </div>

          <div className="shrink-0 border-t border-[#EFE8E3] p-3 sm:p-4">
            <button type="button" className="brand-cta-primary w-full" onClick={attach} disabled={!hasAssets}>
              Attach
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
