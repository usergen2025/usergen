'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api/client';
import { readStorage, readStorageJson, removeStorage, writeStorage } from '@/lib/utils/safeStorage';

// Global auth state to sync across components
let authState = {
  isAuthenticated: false,
  listeners: new Set<() => void>(),
};

const checkAuth = () => {
  const token = readStorage('authToken') || readStorage('authToken', 'session');
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

/** A cached entry without an `id` is useless to the pages that gate on it. */
function readCachedUser(): User | null {
  const cached = readStorageJson<User>('user');
  return cached?.id ? cached : null;
}

/**
 * Shared across every `useAuth` caller so the dozen or so components mounting
 * at once issue a single profile request rather than one each.
 */
let profileRequest: Promise<User | null> | null = null;

/**
 * Recovers the signed-in user when a token exists but no profile is cached.
 *
 * Not every entry point persists the user object at login time, and Safari can
 * evict storage independently of the token's lifetime. Without this, pages
 * gated on `user.id` never fire their fetch and sit on a skeleton forever, so
 * the profile is treated as something derived from the token rather than
 * something each login form has to remember to pass along.
 */
function loadProfileOnce(): Promise<User | null> {
  if (!profileRequest) {
    profileRequest = apiClient
      .getProfile()
      .then((response) => {
        const profile = (response?.success && response.data ? response.data : null) as User | null;
        if (profile) {
          writeStorage('user', JSON.stringify(profile));
        }
        return profile;
      })
      .catch(() => null)
      .then((profile) => {
        // Drop a failed attempt so the next mount can retry rather than leaving
        // the session permanently userless after one transient network error.
        if (!profile) profileRequest = null;
        return profile;
      });
  }
  return profileRequest;
}

export function useAuth() {
  // Initialize with false to avoid SSR issues
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    const authenticated = checkAuth();
    setIsAuthenticated(authenticated);

    if (!authenticated) {
      setIsLoading(false);
    } else {
      const cached = readCachedUser();
      if (cached) {
        setUser(cached);
        setIsLoading(false);
      } else {
        // Deliberately stay loading until the profile resolves: role-gated
        // redirects read `user` as soon as `isLoading` clears, and would send a
        // brand to the creator side of the app if it were still null.
        void loadProfileOnce().then((profile) => {
          if (cancelled) return;
          if (profile) {
            setUser(profile);
          }
          setIsLoading(false);
        });
      }
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
      cancelled = true;
      authState.listeners.delete(updateAuth);
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageChange);
      }
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  const login = useCallback((token: string, useSession = false, userData?: User) => {
    if (typeof window === 'undefined') {
      return;
    }
    writeStorage('authToken', token, useSession ? 'session' : 'local');

    // A fresh session must not reuse the previous account's profile request.
    profileRequest = null;

    if (userData) {
      writeStorage('user', JSON.stringify(userData));
      setUser(userData);
    }

    notifyListeners();
  }, []);

  const logout = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    removeStorage('authToken');
    removeStorage('authToken', 'session');
    removeStorage('user');
    profileRequest = null;
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

