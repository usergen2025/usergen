'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AuthEmailInput,
  AuthField,
  AuthOtpInput,
  AuthSocialRow,
} from '@/components/auth/AuthModalShell';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';
import { writeStorage } from '@/lib/utils/safeStorage';

/** OTP endpoints surface their reason in `message`; anything else falls back. */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '';
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const getSearchParam = useCallback(
    (key: string) => searchParams?.get(key),
    [searchParams]
  );
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();
  const [mobileEmail, setMobileEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const redirectUrl = getSearchParam('redirect') || '/dashboard';
      router.push(redirectUrl);
    }
  }, [isAuthenticated, authLoading, router, getSearchParam]);

  useEffect(() => {
    // Restore saved style from sessionStorage if available
    if (typeof window !== 'undefined') {
      const savedStyle = sessionStorage.getItem('videoCreationStyle');
      const pendingRedirect = sessionStorage.getItem('pendingRedirect');
      
      // If we have saved state, user was in the middle of video creation
      if (savedStyle || pendingRedirect) {
        // State is already saved, just need to handle redirect after login
      }
    }
  }, []);

  const handleSendOtp = async () => {
    if (!mobileEmail.trim()) {
      showToast('Please enter your mobile number or email', 'error');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(mobileEmail.trim());

    if (!isEmail) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    setIsLoading(true);

    try {
      await apiClient.sendOtp({
        email: mobileEmail.trim(),
        type: 'LOGIN',
      });

      setOtpSent(true);
      showToast('OTP sent successfully! Please check your email.', 'success');
    } catch (err: unknown) {
      showToast(errorMessage(err) || 'Failed to send OTP. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      showToast('Please enter a valid 6-digit OTP', 'error');
      return;
    }

    setIsLoading(true);

    try {
      const response = await apiClient.verifyOtp({
        email: mobileEmail.trim(),
        otp,
        type: 'LOGIN',
      });

      if (response.data?.tokens && response.data.tokens.accessToken) {
        // Persist the profile alongside the token — pages gated on `user.id`
        // never fetch their data if only the token is stored.
        login(response.data.tokens.accessToken, false, response.data.user);

        // Store refresh token for future use
        if (response.data.tokens.refreshToken) {
          writeStorage('refreshToken', response.data.tokens.refreshToken);
        }

        showToast('Login successful!', 'success');

        // Get redirect URL from query params or sessionStorage
        const redirectUrl = getSearchParam('redirect') || sessionStorage.getItem('pendingRedirect') || '/';
        const fromParam = getSearchParam('from');
        
        // Clear pending redirect
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('pendingRedirect');
          sessionStorage.removeItem('videoCreationStyle');
        }
        
        // Small delay to show success toast and ensure auth state is updated
        setTimeout(() => {
          const fromCreateVideo = typeof window !== 'undefined' && sessionStorage.getItem('fromCreateVideo') === 'true';
          
          // Clear the flag after checking
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('fromCreateVideo');
          }
          
          // Always redirect to the style page if coming from create-video flow
          if (redirectUrl.includes('/create-video')) {
            // If user came from "Create a Video" button, go to new chat flow
            if (fromCreateVideo) {
              router.push('/create-video/ai-chat');
            } else {
              // Otherwise, go to old style selection flow
            router.push('/create-video/style');
            }
          } else if (redirectUrl === '/dashboard' || redirectUrl === '/dashboard/projects') {
            // Redirect to main projects page instead of dashboard
            router.push('/projects');
          } else {
            router.push(redirectUrl);
          }
        }, 500);
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err: unknown) {
      showToast(errorMessage(err) || 'Invalid OTP. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'facebook') => {
    setIsLoading(true);

    try {
      // Redirect to social login endpoint
      await apiClient.socialLogin(provider);
      // The redirect happens in the API client
    } catch (err: unknown) {
      showToast(errorMessage(err) || `Failed to login with ${provider}`, 'error');
      setIsLoading(false);
    }
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render login form if already authenticated (will redirect)
  if (isAuthenticated) {
    return null;
  }

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mobileEmail.trim());
  const signupHref = `/signup${
    getSearchParam('redirect')
      ? `?redirect=${getSearchParam('redirect')}&from=${getSearchParam('from') || ''}&style=${getSearchParam('style') || ''}`
      : ''
  }`;

  return (
    <div className="gradient-overlay relative flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="brand-gradient-frame relative z-10 w-full max-w-[440px] rounded-[20px] p-2.5 sm:p-3">
        <div className="rounded-[16px] bg-white shadow-sm">
          <div className="border-b border-[#EFE8E3] p-3 sm:p-4">
            <h1 className="brand-campaign-page-title">Login</h1>
            <p className="brand-campaign-meta mt-0.5 text-[#616161]">
              We&apos;ll email you a one time password.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!otpSent) handleSendOtp();
              else handleVerifyOtp();
            }}
            className="space-y-3.5 p-3 sm:p-4"
          >
            <AuthField label="Email" htmlFor="login-page-email">
              <AuthEmailInput
                id="login-page-email"
                value={mobileEmail}
                onChange={setMobileEmail}
                onSend={handleSendOtp}
                canSend={emailIsValid && !isLoading}
                isSending={isLoading && !otpSent}
                disabled={isLoading || otpSent}
              />
            </AuthField>

            <AuthField label="One time password" htmlFor="login-page-otp">
              <AuthOtpInput
                id="login-page-otp"
                value={otp}
                onChange={setOtp}
                disabled={isLoading || !otpSent}
                autoFocus={otpSent}
              />
              <p className="brand-campaign-meta mt-1.5 text-[#616161]">
                {otpSent
                  ? `Code sent to ${mobileEmail.trim()}. Tap send again to resend.`
                  : 'Enter your email, then tap send to get your code.'}
              </p>
            </AuthField>

            <AuthSocialRow onSelect={handleSocialLogin} disabled={isLoading || otpSent} />

            <button
              type="submit"
              className="brand-cta-primary w-full"
              disabled={isLoading || (!otpSent && !emailIsValid) || (otpSent && otp.length !== 6)}
            >
              {isLoading ? (otpSent ? 'Verifying…' : 'Sending…') : otpSent ? 'Login' : 'Send OTP'}
            </button>

            <p className="brand-campaign-meta text-center text-[#616161]">
              Don&apos;t have an account?{' '}
              <Link href={signupHref} className="font-heading font-semibold text-[#E86512] hover:underline">
                Sign up
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
