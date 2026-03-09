'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import LoginModal from '@/components/auth/LoginModal';

interface AuthExpiryContextValue {
  showLoginModalOverlay: boolean;
  setShowLoginModalOverlay: (show: boolean) => void;
}

const AuthExpiryContext = createContext<AuthExpiryContextValue | null>(null);

export function useAuthExpiry() {
  const ctx = useContext(AuthExpiryContext);
  if (!ctx) {
    throw new Error('useAuthExpiry must be used within AuthExpiryProvider');
  }
  return ctx;
}

export function AuthExpiryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { logout } = useAuth();
  const [showLoginModalOverlay, setShowLoginModalOverlay] = useState(false);

  const handleSessionExpired = useCallback(() => {
    logout();
    setShowLoginModalOverlay(true);
  }, [logout]);

  const handleModalClose = useCallback(() => {
    setShowLoginModalOverlay(false);
    logout();
    router.replace('/');
  }, [logout, router]);

  useEffect(() => {
    const handler = () => handleSessionExpired();
    window.addEventListener('auth:session-expired', handler);
    return () => window.removeEventListener('auth:session-expired', handler);
  }, [handleSessionExpired]);

  return (
    <AuthExpiryContext.Provider
      value={{
        showLoginModalOverlay,
        setShowLoginModalOverlay,
      }}
    >
      {children}
      {showLoginModalOverlay && (
        <LoginModal
          isOpen={true}
          onClose={handleModalClose}
          redirectUrl={
            typeof window !== 'undefined'
              ? window.location.pathname + window.location.search
              : undefined
          }
        />
      )}
    </AuthExpiryContext.Provider>
  );
}
