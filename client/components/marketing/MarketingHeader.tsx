'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import MarketingButton from './MarketingButton';
import MarketingLogo from './MarketingLogo';
import { useMarketingAuth } from './MarketingAuthProvider';
import { landing } from '@/lib/content/landing';
import { cn } from '@/lib/utils/cn';

/**
 * Floating nav card for the marketing pages.
 *
 * On mobile the design does not slide a panel in from the side: the same card
 * grows downward in place, from 56px to 287px, keeping the logo row where it
 * was and revealing the links beneath a dashed rule. This is built as one
 * element that changes height for that reason — animating a separate overlay
 * would not land in the same place.
 */
export default function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { openLogin } = useMarketingAuth();
  const { nav } = landing;

  // The card is fixed over the page, so the scrim behind it must not scroll.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <>
      {menuOpen ? (
        <button
          type="button"
          aria-label={nav.closeMenu}
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[14px] md:hidden"
        />
      ) : null}

      <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-[23px] md:top-[30px] md:px-4">
        <div
          className={cn(
            'w-full max-w-[344px] rounded-[14px] border border-mkt-line-cool bg-white',
            'shadow-[0px_4px_16.5px_rgba(0,0,0,0.11)]',
            'md:max-w-[986px] md:rounded-[20px] md:shadow-[0px_4px_45.2px_rgba(0,0,0,0.11)]',
            menuOpen ? 'p-5' : 'px-[11px] py-[10px] md:px-[22px] md:py-3.5'
          )}
        >
          <div className="flex items-center justify-between gap-4 md:gap-11">
            <Link href="/" aria-label="UserGen.ai home" className="shrink-0">
              <MarketingLogo className="h-8 w-[112px] md:h-[43px] md:w-[152px]" />
            </Link>

            <nav className="hidden items-center gap-[26px] md:flex">
              {nav.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="font-mkt-display text-sm font-medium text-mkt-ink-soft transition-colors hover:text-mkt-ink"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <MarketingButton
                variant="quiet"
                onClick={openLogin}
                className="hidden md:inline-flex"
              >
                {nav.login}
              </MarketingButton>

              {/* Closed state pairs the chip with the toggle; open state moves
                  the chip into the panel, as the design shows. */}
              {menuOpen ? null : (
                <MarketingButton variant="quiet" onClick={openLogin} className="md:hidden">
                  {nav.login}
                </MarketingButton>
              )}

              <button
                type="button"
                aria-label={menuOpen ? nav.closeMenu : nav.openMenu}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className={cn(
                  'flex items-center justify-center md:hidden',
                  menuOpen ? 'size-6 text-[#FF4641]' : 'size-[35px] text-mkt-ink'
                )}
              >
                {menuOpen ? <X className="size-6" strokeWidth={2} /> : <Menu className="size-6" />}
              </button>
            </div>
          </div>

          {menuOpen ? (
            <div className="md:hidden">
              <hr className="my-5 border-0 border-t border-dashed border-[#BDB9A8]" />
              <nav className="flex flex-col gap-4">
                {nav.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="font-mkt-display text-sm font-medium text-mkt-ink-soft"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
              <hr className="my-5 border-0 border-t border-dashed border-[#BDB9A8]" />
              <MarketingButton
                variant="quiet"
                fullWidth
                onClick={() => {
                  setMenuOpen(false);
                  openLogin();
                }}
              >
                {nav.login}
              </MarketingButton>
            </div>
          ) : null}
        </div>
      </header>
    </>
  );
}
