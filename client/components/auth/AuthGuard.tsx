'use client';

import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import LoginModal from '@/components/auth/LoginModal';

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * For create-video routes: when not authenticated, show page content with
 * translucent LoginModal overlay (same as homepage) instead of redirecting to /login.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-text-primary">Loading...</p>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {children}
      {!isAuthenticated && (
        <LoginModal
          isOpen={true}
          onClose={() => {}}
          redirectUrl={
            typeof window !== 'undefined'
              ? window.location.pathname + window.location.search
              : undefined
          }
        />
      )}
    </div>
  );
}
