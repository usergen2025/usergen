'use client';

import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

export default function Card({
  children,
  selected = false,
  onClick,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg p-4',
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:border-primary',
        selected && 'border-primary bg-primary-light',
        className
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  );
}


