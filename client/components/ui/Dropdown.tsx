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
            'absolute z-50 mt-3 min-w-[200px] bg-white rounded-xl border border-gray-100 shadow-[0_12px_40px_-8px_rgba(15,8,43,0.18)] ring-1 ring-black/5 overflow-hidden',
            align === 'right' ? 'right-0' : 'left-0',
            className
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
        'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left text-[#0F082B] hover:text-[#E86512] hover:bg-gray-50 transition-colors',
        className
      )}
    >
      {icon && <span className="w-5 h-5 flex items-center justify-center text-[#0F082B]">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

