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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-text-secondary">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated || !isBrand()) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="pb-8 pt-0 sm:pt-2 md:pt-[43px]">
        {children}
      </main>
    </div>
  );
}

