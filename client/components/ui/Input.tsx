'use client';

import { InputHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  onIconClick?: () => void;
  /** Tighter control for brand dense layouts */
  fieldSize?: 'md' | 'sm';
  variant?: 'default' | 'brandCapsule';
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      icon,
      iconPosition = 'right',
      onIconClick,
      fieldSize = 'md',
      variant = 'default',
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <div className="w-full">
        {label && (
          <label
            className={cn('block font-medium text-text-primary mb-1', fieldSize === 'sm' ? 'text-xs' : 'text-sm')}
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && iconPosition === 'left' && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
              {icon}
            </div>
        )}
        <input
          ref={ref}
          className={cn(
            variant === 'brandCapsule'
              ? 'brand-field-capsule disabled:opacity-60 disabled:cursor-not-allowed'
              : [
                  'w-full border border-border rounded-md',
                  'bg-secondary text-text-primary',
                  'placeholder:text-text-muted',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  fieldSize === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2',
                ],
            error && 'border-red-500 focus:ring-red-500',
            icon && iconPosition === 'left' && (fieldSize === 'sm' ? 'pl-9' : 'pl-10'),
            icon && iconPosition === 'right' && (fieldSize === 'sm' ? 'pr-9' : 'pr-10'),
            className
          )}
          {...props}
        />
          {icon && iconPosition === 'right' && (
            <div 
              className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 z-10",
                onIconClick && "cursor-pointer"
              )}
              onClick={onIconClick}
            >
              {icon}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1 text-sm text-red-500">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;

