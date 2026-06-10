'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export default function Tooltip({
  content,
  children,
  position = 'top',
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const trigger = triggerRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();

    let x = 0;
    let y = 0;

    switch (position) {
      case 'top':
        x = trigger.left + trigger.width / 2 - tooltip.width / 2;
        y = trigger.top - tooltip.height - 8;
        break;
      case 'bottom':
        x = trigger.left + trigger.width / 2 - tooltip.width / 2;
        y = trigger.bottom + 8;
        break;
      case 'left':
        x = trigger.left - tooltip.width - 8;
        y = trigger.top + trigger.height / 2 - tooltip.height / 2;
        break;
      case 'right':
        x = trigger.right + 8;
        y = trigger.top + trigger.height / 2 - tooltip.height / 2;
        break;
    }

    setCoords({ x, y });
  }, [visible, position]);

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          className={cn(
            'fixed z-[100] rounded-xl border border-[#E8E2DB] bg-[#FFFBF8] px-3 py-2 text-xs text-[#212121] shadow-lg',
            'animate-in fade-in-0 zoom-in-95 duration-150',
            className,
          )}
          style={{ left: coords.x, top: coords.y }}
        >
          {content}
          <div
            className={cn(
              'absolute h-2.5 w-2.5 rotate-45 border-[#E8E2DB] bg-[#FFFBF8]',
              position === 'top' && 'bottom-[-5px] left-1/2 -translate-x-1/2 border-b border-r',
              position === 'bottom' && 'top-[-5px] left-1/2 -translate-x-1/2 border-l border-t',
              position === 'left' && 'right-[-5px] top-1/2 -translate-y-1/2 border-r border-t',
              position === 'right' && 'left-[-5px] top-1/2 -translate-y-1/2 border-b border-l',
            )}
          />
        </div>
      )}
    </div>
  );
}
