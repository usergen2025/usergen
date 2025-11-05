'use client';

import { useState, useEffect, useCallback } from 'react';

// Global auth state to sync across components
let authState = {
  isAuthenticated: false,
  listeners: new Set<() => void>(),
};

const checkAuth = () => {
  // Check if we're in the browser environment
  if (typeof window === 'undefined') {
    return false;
  }
  const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
  return !!token;
};

const notifyListeners = () => {
  authState.isAuthenticated = checkAuth();
  authState.listeners.forEach(listener => listener());
};

export function useAuth() {
  // Initialize with false to avoid SSR issues
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Only check auth on client side
    if (typeof window !== 'undefined') {
      setIsAuthenticated(checkAuth());
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }

    // Listener for state updates
    const updateAuth = () => {
      setIsAuthenticated(checkAuth());
    };

    authState.listeners.add(updateAuth);

    // Listen for storage changes (cross-tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'authToken') {
        updateAuth();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
    }

    // Poll for changes (in case of same-tab updates)
    const interval = setInterval(() => {
      const currentAuth = checkAuth();
      if (currentAuth !== isAuthenticated) {
        updateAuth();
      }
    }, 100);

    return () => {
      authState.listeners.delete(updateAuth);
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageChange);
      }
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  const login = useCallback((token: string, useSession = false) => {
    // Check if we're in the browser environment
    if (typeof window === 'undefined') {
      return;
    }
    if (useSession) {
      sessionStorage.setItem('authToken', token);
    } else {
      localStorage.setItem('authToken', token);
    }
    notifyListeners();
  }, []);

  const logout = useCallback(() => {
    // Check if we're in the browser environment
    if (typeof window === 'undefined') {
      return;
    }
    localStorage.removeItem('authToken');
    sessionStorage.removeItem('authToken');
    notifyListeners();
  }, []);

  return { isAuthenticated, isLoading, login, logout };
}

