'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}

export default function Dropdown({ trigger, children, className, align = 'right' }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative">
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>
      {isOpen && (
        <div
          className={cn(
            'absolute z-[120] mt-2 min-w-[200px] overflow-hidden rounded-2xl border border-[#E6DBD2] bg-white shadow-[0_12px_40px_-8px_rgba(15,8,43,0.18)] ring-1 ring-black/5',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          <div className="flex flex-col gap-2 p-2">
          {children}
          </div>
        </div>
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
  return (
    <button
      onClick={onClick}
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

