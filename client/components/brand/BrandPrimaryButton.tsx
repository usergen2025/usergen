'use client';

import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface BrandPrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  /** Wider CTA for hero rows */
  fullWidth?: boolean;
  /** Default: Figma ~52px; `sm` for toolbars and dense rows */
  size?: 'md' | 'sm';
}

/**
 * Figma primary brand CTA: ~52px min height, 26px radius, 90° gradient.
 */
const BrandPrimaryButton = forwardRef<HTMLButtonElement, BrandPrimaryButtonProps>(
  ({ className, children, icon, fullWidth, size = 'md', type = 'button', ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'brand-cta-primary',
          size === 'sm' && 'brand-cta-primary--sm',
          fullWidth && 'w-full',
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);
BrandPrimaryButton.displayName = 'BrandPrimaryButton';

export default BrandPrimaryButton;
