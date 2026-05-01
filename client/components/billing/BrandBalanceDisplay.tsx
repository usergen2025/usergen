'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IndianRupee, Wallet } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';

interface BrandBalanceDisplayProps {
  className?: string;
}

export default function BrandBalanceDisplay({ className }: BrandBalanceDisplayProps) {
  const router = useRouter();
  const { isAuthenticated, isBrand, user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!isAuthenticated || !isBrand() || !user?.id) return;
    setIsLoading(true);
    try {
      const response = await apiClient.getCreditsBalance(user.id);
      const d = response.data;
      if (d && typeof (d as { credits?: number }).credits === 'number') {
        setBalance((d as { credits: number }).credits);
        return;
      }
      setBalance(0);
    } catch {
      setBalance(null);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, isBrand, user?.id]);

  useEffect(() => {
    void fetchBalance();
  }, [fetchBalance]);

  useEffect(() => {
    const onRefresh = () => {
      void fetchBalance();
    };
    window.addEventListener('credits-refresh', onRefresh);
    return () => window.removeEventListener('credits-refresh', onRefresh);
  }, [fetchBalance]);

  useEffect(() => {
    if (!isAuthenticated || !isBrand()) return;
    const interval = setInterval(() => void fetchBalance(), 45000);
    return () => clearInterval(interval);
  }, [isAuthenticated, isBrand, fetchBalance]);

  if (!isAuthenticated || !isBrand()) {
    return null;
  }

  const display = balance !== null ? balance : '—';

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer transition-all',
        'bg-gradient-to-r from-orange-50 to-pink-50 hover:from-orange-100 hover:to-pink-100',
        'border border-orange-200/50',
        className
      )}
      onClick={() => router.push('/brand/wallet')}
      title="View wallet"
      role="button"
    >
      <Wallet className="w-4 h-4 text-orange-500" />
      <span className="font-medium text-sm text-gray-700 flex items-center gap-0.5">
        {isLoading ? (
          <span className="inline-block w-12 h-4 bg-gray-200/80 rounded animate-pulse" />
        ) : (
          <>
            <IndianRupee className="w-3.5 h-3.5 text-gray-500" />
            {typeof display === 'number' ? display.toLocaleString('en-IN') : display}
          </>
        )}
      </span>
    </div>
  );
}
