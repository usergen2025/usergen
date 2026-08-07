'use client';

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';
import { useCloseOnRouteChange } from '@/hooks/useCloseOnRouteChange';

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}

/** Lets `DropdownItem` dismiss its own menu without every caller wiring it up. */
const DropdownCloseContext = createContext<(() => void) | null>(null);

/** Breathing room kept between the menu and every viewport edge. */
const VIEWPORT_MARGIN = 8;

export default function Dropdown({ trigger, children, className, align = 'right' }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useCloseOnRouteChange(() => setIsOpen(false));

  /**
   * The menu is portalled to `body` and positioned by hand: callers routinely
   * render it inside scroll containers with `overflow-hidden`, which would clip
   * an absolutely-positioned menu.
   */
  const updatePos = useCallback(() => {
    const trigger = dropdownRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const anchor = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;

    const preferredLeft = align === 'right' ? anchor.right - width : anchor.left;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, maxLeft));

    // Flip above the trigger when there isn't room below it.
    const below = anchor.bottom + VIEWPORT_MARGIN;
    const top =
      below + height > window.innerHeight - VIEWPORT_MARGIN && anchor.top - height > VIEWPORT_MARGIN
        ? anchor.top - height - VIEWPORT_MARGIN
        : below;

    setPos({ top, left });
  }, [align]);

  useLayoutEffect(() => {
    if (isOpen) updatePos();
  }, [isOpen, updatePos]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen, updatePos]);

  return (
    <div ref={dropdownRef} className="relative">
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              top: pos.top,
              left: pos.left,
              maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
            }}
            className={cn(
              'fixed z-[120] max-h-[min(60vh,420px)] min-w-[200px] overflow-y-auto overflow-x-hidden rounded-2xl border border-[#E6DBD2] bg-white shadow-[0_12px_40px_-8px_rgba(15,8,43,0.18)] ring-1 ring-black/5',
              className,
            )}
          >
            <div className="flex flex-col gap-2 p-2">
              <DropdownCloseContext.Provider value={() => setIsOpen(false)}>
                {children}
              </DropdownCloseContext.Provider>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

interface DropdownItemProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  icon?: ReactNode;
}

export function DropdownItem({ children, onClick, className, icon }: DropdownItemProps) {
  const closeDropdown = useContext(DropdownCloseContext);

  return (
    <button
      onClick={() => {
        onClick?.();
        closeDropdown?.();
      }}
      className={cn(
        'w-full rounded-xl px-4 py-2.5 text-left font-heading text-[clamp(12px,1.37vh,14px)] font-medium text-[#212121] transition-colors hover:bg-gray-50 hover:text-[#E86512]',
        'flex items-center gap-2.5',
        className,
      )}
    >
      {icon && <span className="flex h-4 w-4 items-center justify-center text-[#212121]">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

