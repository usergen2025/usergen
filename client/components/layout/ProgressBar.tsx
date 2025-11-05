'use client';

import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';

interface ProgressBarProps {
  progress: number; // 0-100
  message: string;
  nextRoute?: string;
  onNext?: () => void;
  disabled?: boolean;
}

export default function ProgressBar({ 
  progress, 
  message, 
  nextRoute,
  onNext,
  disabled = false
}: ProgressBarProps) {
  const router = useRouter();

  const handleNext = () => {
    if (disabled) return;
    
    if (onNext) {
      onNext();
    } else if (nextRoute) {
      router.push(nextRoute);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-secondary border-t border-border px-4 md:px-6 py-4 z-40">
      <div className="container mx-auto flex items-center justify-between gap-4">
        <p className="text-xs md:text-sm text-text-primary flex-1 min-w-0">{message}</p>
        
        <div className="flex-1 max-w-xs bg-primary-light rounded-full h-2 relative mx-4">
          <div
            className="bg-primary h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-secondary">
            {progress}%
          </span>
        </div>

        <Button
          variant="primary"
          size="sm"
          icon={<ArrowRight className="w-4 h-4" />}
          iconPosition="right"
          onClick={handleNext}
          disabled={disabled}
          className="rounded-full w-10 h-10 p-0 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

