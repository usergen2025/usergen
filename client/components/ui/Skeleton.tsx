import { cn } from '@/lib/utils/cn';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
}

function Skeleton({ className, variant = 'rectangular' }: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-primary-light/30 rounded';
  
  const variantClasses = {
    text: 'h-4',
    circular: 'rounded-full',
    rectangular: 'rounded',
  };

  return (
    <div
      className={cn(
        baseClasses,
        variantClasses[variant],
        className
      )}
    />
  );
}

// Skeleton card for B-roll images/videos
export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-primary-light/20 bg-background">
      {/* Image/Video area */}
      <div className="relative aspect-[9/16] bg-primary-light/20">
        <Skeleton className="w-full h-full" variant="rectangular" />
        <div className="absolute top-2 right-2">
          <Skeleton className="w-12 h-5" variant="rectangular" />
        </div>
      </div>
      
      {/* Content area */}
      <div className="p-4 space-y-3">
        {/* Script text */}
        <div className="space-y-2">
          <Skeleton className="w-12 h-3" variant="text" />
          <Skeleton className="w-full h-3" variant="text" />
          <Skeleton className="w-4/5 h-3" variant="text" />
        </div>
        
        {/* Regenerate button */}
        <Skeleton className="w-full h-9" variant="rectangular" />
      </div>
    </div>
  );
}

export default Skeleton;

