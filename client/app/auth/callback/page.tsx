'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const { showToast } = useToast();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const accessToken = searchParams?.get('access_token');
        const refreshToken = searchParams?.get('refresh_token');
        const error = searchParams?.get('error');

        if (error) {
          setStatus('error');
          setErrorMessage(decodeURIComponent(error));
          showToast('Login failed: ' + decodeURIComponent(error), 'error');
          setTimeout(() => router.push('/login'), 3000);
          return;
        }

        if (!accessToken) {
          setStatus('error');
          setErrorMessage('No access token received');
          showToast('Login failed: No access token received', 'error');
          setTimeout(() => router.push('/login'), 3000);
          return;
        }

        // Store the tokens
        login(accessToken);
        
        if (refreshToken) {
          localStorage.setItem('refreshToken', refreshToken);
        }

        // Fetch user profile to get user data
        try {
          const profileResponse = await apiClient.getProfile();
          if (profileResponse.data) {
            localStorage.setItem('user', JSON.stringify(profileResponse.data));
          }
        } catch (profileError) {
          console.warn('Failed to fetch profile after OAuth login:', profileError);
        }

        setStatus('success');
        showToast('Successfully logged in!', 'success');

        // Check for pending redirect from video creation flow
        const pendingRedirect = sessionStorage.getItem('pendingRedirect');
        if (pendingRedirect) {
          sessionStorage.removeItem('pendingRedirect');
          router.push(pendingRedirect);
        } else {
          // Check user role and redirect appropriately
          const userStr = localStorage.getItem('user');
          if (userStr) {
            try {
              const user = JSON.parse(userStr);
              if (user.role === 'BRAND') {
                router.push('/brand/dashboard');
              } else {
                router.push('/dashboard');
              }
            } catch {
              router.push('/dashboard');
            }
          } else {
            router.push('/dashboard');
          }
        }
      } catch (err: any) {
        console.error('OAuth callback error:', err);
        setStatus('error');
        setErrorMessage(err.message || 'An unexpected error occurred');
        showToast('Login failed: ' + (err.message || 'Unknown error'), 'error');
        setTimeout(() => router.push('/login'), 3000);
      }
    };

    handleCallback();
  }, [searchParams, login, router, showToast]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#FFF5F0] to-[#FFF0F5]">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full mx-4 text-center">
        {status === 'processing' && (
          <>
            <div className="mb-6">
              <div className="w-16 h-16 border-4 border-[#FF6B6B] border-t-transparent rounded-full animate-spin mx-auto"></div>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Completing Login</h1>
            <p className="text-gray-600">Please wait while we verify your credentials...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Login Successful!</h1>
            <p className="text-gray-600">Redirecting you to your dashboard...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Login Failed</h1>
            <p className="text-gray-600 mb-4">{errorMessage}</p>
            <p className="text-sm text-gray-500">Redirecting to login page...</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#FFF5F0] to-[#FFF0F5]">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full mx-4 text-center">
          <div className="mb-6">
            <div className="w-16 h-16 border-4 border-[#FF6B6B] border-t-transparent rounded-full animate-spin mx-auto"></div>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Loading...</h1>
        </div>
      </div>
    }>
      <OAuthCallbackContent />
    </Suspense>
  );
}
