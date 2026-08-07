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

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  credits?: number;
  brandName?: string | null;
  brandLogo?: string | null;
}

export function useAuth() {
  // Initialize with false to avoid SSR issues
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Only check auth on client side
    if (typeof window !== 'undefined') {
      const authenticated = checkAuth();
      setIsAuthenticated(authenticated);
      
      // Load user from localStorage if authenticated
      if (authenticated) {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          try {
            setUser(JSON.parse(userStr));
          } catch (e) {
            // Invalid JSON, ignore
          }
        }
      }
      
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

  const login = useCallback((token: string, useSession = false, userData?: User) => {
    // Check if we're in the browser environment
    if (typeof window === 'undefined') {
      return;
    }
    if (useSession) {
      sessionStorage.setItem('authToken', token);
    } else {
      localStorage.setItem('authToken', token);
    }
    
    // Store user data if provided
    if (userData) {
      localStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
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
    localStorage.removeItem('user');
    setUser(null);
    notifyListeners();
  }, []);

  const isBrand = useCallback(() => {
    return user?.role === 'BRAND';
  }, [user]);

  const isCreator = useCallback(() => {
    return user?.role === 'USER' || user?.role === 'AVATAR_CREATOR';
  }, [user]);

  return { 
    isAuthenticated, 
    isLoading, 
    user,
    login, 
    logout,
    isBrand,
    isCreator,
  };
}

