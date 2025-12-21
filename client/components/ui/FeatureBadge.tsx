'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface FeatureBadgeProps {
  icon: ReactNode;
  label: string;
  className?: string;
}

export default function FeatureBadge({ icon, label, className }: FeatureBadgeProps) {
  return (
    <div className={cn(
      "flex flex-row items-center justify-center gap-2.5 px-4 py-1.5",
      "bg-white shadow-card rounded-[41px]",
      className
    )}>
      <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {icon}
      </div>
      <span className="font-sans text-base text-text-secondary whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

