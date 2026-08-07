'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { typography } from '@/lib/config/theme';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  /** `xs` = compact density (brand tables, toolbars, list actions) */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  children?: ReactNode;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className,
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
  
  const variants = {
    primary: 'gradient-primary text-white shadow-button hover:opacity-90',
    secondary: 'gradient-secondary text-black hover:opacity-90',
    outline: 'bg-transparent text-black border border-border hover:bg-primary-light',
  };

  const sizes = {
    xs: 'px-3.5 py-1.5 text-xs rounded-[18px] gap-0.5',
    sm: 'px-4 py-2.5 sm:px-6 sm:py-3 text-base rounded-[26px]',
    md: 'px-4 py-3 sm:px-6 sm:py-4 text-base rounded-[26px]',
    lg: 'px-5 py-3 sm:px-6 sm:py-4 text-base rounded-[32px] sm:rounded-[40px]',
  };

  return (
    <button
      className={cn(
        baseStyles,
        variants[variant],
        sizes[size],
        size === 'xs'
          ? 'font-medium'
          : variant === 'primary'
            ? typography.button.primary
            : variant === 'secondary'
              ? typography.button.secondary
              : typography.button.outline,
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {icon && iconPosition === 'left' && <span className="mr-2">{icon}</span>}
      {children}
      {icon && iconPosition === 'right' && <span className="ml-2">{icon}</span>}
    </button>
  );
}

