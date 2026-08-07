'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function BrandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading, isBrand } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        router.push('/login?redirect=' + encodeURIComponent('/brand/dashboard'));
      } else if (!isBrand()) {
        // Redirect non-brand users away from brand pages
        router.push('/dashboard');
      }
    }
  }, [isAuthenticated, isLoading, isBrand, router]);

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-text-secondary">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated || !isBrand()) {
    return null;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden app-global-gradient">
      <div className="pointer-events-none absolute -top-40 -right-52 h-[34rem] w-[34rem] rounded-full bg-[#E86512]/10 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-52 -left-52 h-[34rem] w-[34rem] rounded-full bg-[#E86512]/10 blur-[140px]" />
      <main className="flex min-h-0 w-full max-w-full flex-1 flex-col pb-0 pt-0">
        <div className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </main>
    </div>
  );
}

