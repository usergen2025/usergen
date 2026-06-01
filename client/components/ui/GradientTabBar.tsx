'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface GradientTabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface GradientTabBarProps {
  tabs: GradientTabItem[];
  value: string;
  onChange: (id: string) => void;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export function GradientTabBar({
  tabs,
  value,
  onChange,
  size = 'md',
  className,
}: GradientTabBarProps) {
  const isXs = size === 'xs';
  const isSm = size === 'sm';

  return (
    <div
      className={cn(
        'relative w-full flex-shrink-0 box-border',
        isXs ? 'rounded-[24px] h-[clamp(28px,3.52vh,36px)]' : isSm ? 'rounded-[24px]' : 'rounded-[28px]',
        className,
      )}
      style={{
        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)',
        padding: isXs ? '1px' : '2px',
        boxShadow: isXs ? 'inset 0 0 0 0 transparent' : undefined,
      }}
    >
      <div
        className={cn(
          'flex flex-row justify-center items-center bg-white w-full h-full box-border',
          isXs
            ? 'rounded-[22px] p-[3px] gap-[2px]'
            : isSm
              ? 'rounded-[22px] p-1 gap-1'
              : 'rounded-[26px] p-1 gap-1',
        )}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                'flex flex-row justify-center items-center flex-1 min-w-0 transition-all duration-300 ease-in-out',
                isXs
                  ? 'gap-[clamp(4px,0.5vw,6px)] px-1.5 h-full rounded-[17px]'
                  : isSm
                    ? 'gap-1.5 px-2 py-1.5 rounded-[20px] h-8'
                    : 'gap-2.5 px-3 py-2 rounded-[24px] h-9',
                active
                  ? 'bg-gradient-to-r from-[#E86412] to-[#F12A4C]'
                  : 'bg-transparent hover:bg-gray-50',
              )}
            >
              {tab.icon ? (
                <span
                  className={cn(
                    'flex items-center justify-center shrink-0',
                    isXs ? 'w-3 h-3' : isSm ? 'w-4 h-4' : 'w-5 h-5',
                    active && '[&_img]:brightness-0 [&_img]:invert',
                  )}
                >
                  {tab.icon}
                </span>
              ) : null}
              <span
                className={cn(
                  'font-heading truncate',
                  isXs
                    ? 'text-[clamp(11px,1.27vh,13px)] leading-[clamp(13px,1.47vh,15px)]'
                    : isSm
                      ? 'text-[12px] leading-[14px]'
                      : 'text-[14px] leading-[16px]',
                  active ? 'font-medium text-white' : 'font-normal text-[#212121]',
                )}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
