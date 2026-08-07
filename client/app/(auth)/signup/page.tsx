'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AuthField,
  AuthModalShell,
  AuthOtpInput,
  AuthSocialRow,
  AuthTextInput,
} from '@/components/auth/AuthModalShell';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';

/** OTP endpoints surface their reason in `message`; anything else falls back. */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '';
}

function SignupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const getSearchParam = useCallback(
    (key: string) => searchParams?.get(key),
    [searchParams]
  );
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    mobile: '',
  });
  const [otp, setOtp] = useState('');
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const redirectUrl = getSearchParam('redirect') || '/dashboard';
      router.push(redirectUrl);
    }
  }, [isAuthenticated, authLoading, router, getSearchParam]);

  const handleSendOtp = async () => {
    // Validate inputs
    if (!formData.name.trim()) {
      showToast('Please enter your name', 'error');
      return;
    }
    if (!formData.email.trim()) {
      showToast('Please enter your email', 'error');
      return;
    }
    if (!formData.mobile.trim()) {
      showToast('Please enter your mobile number', 'error');
      return;
    }

    // Basic validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    setIsLoading(true);

    try {
      await apiClient.sendOtp({
        email: formData.email.trim(),
        mobile: formData.mobile.trim(),
        type: 'EMAIL_VERIFICATION',
      });

      setOtpSent(true);
      setShowOtpModal(true);
      showToast('OTP sent successfully! Please check your email and mobile.', 'success');
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
        email: formData.email.trim(),
        otp,
        type: 'EMAIL_VERIFICATION',
        name: formData.name.trim(),
        mobile: formData.mobile.trim(),
      });

      if (response.data?.tokens && response.data.tokens.accessToken) {
        // Store tokens
        login(response.data.tokens.accessToken);
        
        // Store refresh token for future use
        if (response.data.tokens.refreshToken) {
          localStorage.setItem('refreshToken', response.data.tokens.refreshToken);
        }

        showToast('Registration successful! Welcome to UserGen.ai', 'success');

        // Get redirect URL from query params or sessionStorage
        const redirectUrl = getSearchParam('redirect') || sessionStorage.getItem('pendingRedirect') || '/dashboard';
        const fromParam = getSearchParam('from');
        
        // Clear pending redirect
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('pendingRedirect');
          sessionStorage.removeItem('videoCreationStyle');
        }
        
        // Close modal
        setShowOtpModal(false);
        
        // Small delay to show success toast
        setTimeout(() => {
          const fromCreateVideo = typeof window !== 'undefined' && sessionStorage.getItem('fromCreateVideo') === 'true';
          
          // Clear the flag after checking
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('fromCreateVideo');
          }
          
          // If coming from create-video flow
          if (redirectUrl.includes('/create-video')) {
            // If user came from "Create a Video" button, go to new chat flow
            if (fromCreateVideo) {
              router.push('/create-video/ai-chat');
            } else {
              // Otherwise, go to old style selection flow
              router.push('/create-video/style');
            }
          } else if (fromParam === 'style' || redirectUrl === '/create-video') {
            // Generic create-video redirect should go to new AI chat flow
            router.push('/create-video/ai-chat');
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

  const handleSocialSignup = async (provider: 'google' | 'facebook') => {
    setIsLoading(true);

    try {
      // Redirect to social login endpoint
      await apiClient.socialLogin(provider);
      // The redirect happens in the API client
    } catch (err: unknown) {
      showToast(errorMessage(err) || `Failed to sign up with ${provider}`, 'error');
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

  // Don't render signup form if already authenticated (will redirect)
  if (isAuthenticated) {
    return null;
  }

  const loginHref = `/login${
    getSearchParam('redirect')
      ? `?redirect=${getSearchParam('redirect')}&from=${getSearchParam('from') || ''}&style=${getSearchParam('style') || ''}`
      : ''
  }`;

  return (
    <div className="gradient-overlay relative flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="brand-gradient-frame relative z-10 w-full max-w-[440px] rounded-[20px] p-2.5 sm:p-3">
        <div className="rounded-[16px] bg-white shadow-sm">
          <div className="border-b border-[#EFE8E3] p-3 sm:p-4">
            <h1 className="brand-campaign-page-title">Sign up</h1>
            <p className="brand-campaign-meta mt-0.5 text-[#616161]">
              We&apos;ll send a one time password to confirm it&apos;s you.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!otpSent) handleSendOtp();
            }}
            className="space-y-3.5 p-3 sm:p-4"
          >
            <AuthField label="Name" htmlFor="signup-page-name">
              <AuthTextInput
                id="signup-page-name"
                type="text"
                placeholder="Your full name"
                autoComplete="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isLoading || otpSent}
              />
            </AuthField>

            <AuthField label="Email" htmlFor="signup-page-email">
              <AuthTextInput
                id="signup-page-email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isLoading || otpSent}
              />
            </AuthField>

            <AuthField label="Mobile" htmlFor="signup-page-mobile">
              <AuthTextInput
                id="signup-page-mobile"
                type="tel"
                placeholder="Your mobile number"
                autoComplete="tel"
                required
                value={formData.mobile}
                onChange={(e) =>
                  setFormData({ ...formData, mobile: e.target.value.replace(/[^\d\s\-+]/g, '') })
                }
                disabled={isLoading || otpSent}
              />
            </AuthField>

            {otpSent && (
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setShowOtpModal(false);
                  setOtp('');
                }}
                disabled={isLoading}
                className="brand-cta-secondary w-full"
              >
                Change details
              </button>
            )}

            <AuthSocialRow onSelect={handleSocialSignup} disabled={isLoading || otpSent} />

            <button
              type="submit"
              className="brand-cta-primary w-full"
              disabled={isLoading || otpSent}
            >
              {isLoading ? 'Sending…' : otpSent ? 'OTP sent' : 'Send OTP'}
            </button>

            <p className="brand-campaign-meta text-center text-[#616161]">
              Already have an account?{' '}
              <Link href={loginHref} className="font-heading font-semibold text-[#E86512] hover:underline">
                Login
              </Link>
            </p>
          </form>
        </div>
      </div>

      <AuthModalShell
        isOpen={showOtpModal}
        onClose={() => {
          if (!isLoading) setShowOtpModal(false);
        }}
        title="Enter your code"
        subtitle={`Sent to ${formData.email} and ${formData.mobile}`}
        footer={
          <button
            type="button"
            onClick={handleVerifyOtp}
            disabled={isLoading || otp.length !== 6}
            className="brand-cta-primary w-full"
          >
            {isLoading ? 'Verifying…' : 'Verify OTP'}
          </button>
        }
      >
        <AuthField label="One time password" htmlFor="signup-page-otp">
          <AuthOtpInput
            id="signup-page-otp"
            value={otp}
            onChange={setOtp}
            disabled={isLoading}
            autoFocus
          />
        </AuthField>
        <button
          type="button"
          onClick={handleSendOtp}
          disabled={isLoading}
          className="brand-campaign-meta mt-2.5 w-full text-center font-heading font-semibold text-[#E86512] hover:underline disabled:opacity-50"
        >
          Resend OTP
        </button>
      </AuthModalShell>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <SignupPageContent />
    </Suspense>
  );
}
