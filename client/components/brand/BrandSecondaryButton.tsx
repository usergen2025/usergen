'use client';

import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface BrandSecondaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  fullWidth?: boolean;
  size?: 'md' | 'sm';
}

const BrandSecondaryButton = forwardRef<HTMLButtonElement, BrandSecondaryButtonProps>(
  ({ className, children, fullWidth, size = 'md', type = 'button', ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'brand-cta-secondary',
          size === 'sm' && 'brand-cta-secondary--sm',
          fullWidth && 'w-full',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
BrandSecondaryButton.displayName = 'BrandSecondaryButton';

export default BrandSecondaryButton;
