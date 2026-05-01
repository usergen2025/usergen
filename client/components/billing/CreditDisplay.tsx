'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, Plus, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';
import Button from '@/components/ui/Button';

interface CreditDisplayProps {
  className?: string;
  showAddButton?: boolean;
  variant?: 'compact' | 'full';
}

export default function CreditDisplay({ 
  className, 
  showAddButton = true,
  variant = 'compact'
}: CreditDisplayProps) {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchCredits = useCallback(async () => {
    if (!isAuthenticated || !user?.id) return;
    
    setIsLoading(true);
    
    try {
      const response = await apiClient.getCreditsBalance(user.id);
      if (response.success && response.data !== undefined) {
        const d = response.data as { credits?: number };
        setCredits(typeof d.credits === 'number' ? d.credits : 0);
      } else {
        setCredits(0);
      }
    } catch (err) {
      console.warn('Failed to fetch credits from wallet service:', err);
      setCredits(null);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  useEffect(() => {
    const onCreditsRefresh = () => {
      void fetchCredits();
    };
    window.addEventListener('credits-refresh', onCreditsRefresh);
    return () => window.removeEventListener('credits-refresh', onCreditsRefresh);
  }, [fetchCredits]);

  // Refresh credits periodically (every 60 seconds)
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const interval = setInterval(() => void fetchCredits(), 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchCredits]);

  if (!isAuthenticated) {
    return null;
  }

  const handleClick = () => {
    router.push('/billing');
  };

  const handleAddCredits = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push('/billing?action=add');
  };

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer transition-all",
          "bg-gradient-to-r from-orange-50 to-pink-50 hover:from-orange-100 hover:to-pink-100",
          "border border-orange-200/50",
          className
        )}
        onClick={handleClick}
        title="View billing"
      >
        <Wallet className="w-4 h-4 text-orange-500" />
        <span className="font-medium text-sm text-gray-700">
          {isLoading ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : credits === null ? (
            '—'
          ) : (
            <>₹{credits.toLocaleString()}</>
          )}
        </span>
        {showAddButton && (
          <button
            onClick={handleAddCredits}
            className="ml-1 p-0.5 rounded-full hover:bg-orange-200/50 transition-colors"
            title="Add credits"
          >
            <Plus className="w-3.5 h-3.5 text-orange-600" />
          </button>
        )}
      </div>
    );
  }

  // Full variant for billing page
  return (
    <div
      className={cn(
        "flex items-center justify-between p-4 rounded-2xl",
        "bg-gradient-to-r from-orange-100 to-pink-100",
        "border border-orange-200",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm">
          <Wallet className="w-6 h-6 text-orange-500" />
        </div>
        <div>
          <p className="text-sm text-gray-600">Available Credits</p>
          <p className="text-2xl font-bold text-gray-800">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Loading...
              </span>
            ) : credits === null ? (
              '—'
            ) : (
              <>₹{credits.toLocaleString()}</>
            )}
          </p>
        </div>
      </div>
      {showAddButton && (
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={handleAddCredits}
        >
          Add Credits
        </Button>
      )}
    </div>
  );
}
