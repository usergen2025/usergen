'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { Chrome, Facebook } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();
  const [mobileEmail, setMobileEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const redirectUrl = searchParams.get('redirect') || '/dashboard';
      router.push(redirectUrl);
    }
  }, [isAuthenticated, authLoading, router, searchParams]);

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
      setShowOtpModal(true);
      showToast('OTP sent successfully! Please check your email.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to send OTP. Please try again.', 'error');
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
        // Store tokens - this will trigger auth state update
        login(response.data.tokens.accessToken);
        
        // Store refresh token for future use
        if (response.data.tokens.refreshToken) {
          localStorage.setItem('refreshToken', response.data.tokens.refreshToken);
        }

        showToast('Login successful!', 'success');

        // Get redirect URL from query params or sessionStorage
        const redirectUrl = searchParams.get('redirect') || sessionStorage.getItem('pendingRedirect') || '/';
        const fromParam = searchParams.get('from');
        
        // Clear pending redirect
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('pendingRedirect');
          sessionStorage.removeItem('videoCreationStyle');
        }
        
        // Close modal
        setShowOtpModal(false);
        
        // Small delay to show success toast and ensure auth state is updated
        setTimeout(() => {
          // Always redirect to the style page if coming from create-video flow
          if (redirectUrl.includes('/create-video')) {
            router.push('/create-video/style');
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
    } catch (err: any) {
      showToast(err.message || 'Invalid OTP. Please try again.', 'error');
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
    } catch (err: any) {
      showToast(err.message || `Failed to login with ${provider}`, 'error');
      setIsLoading(false);
    }
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-secondary border border-border rounded-lg p-8 space-y-6">
        <h1 className={cn(typography.heading.h3, "text-center")}>Login</h1>
        
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (!otpSent) {
              handleSendOtp();
            }
          }} 
          className="space-y-4"
        >
          <Input
            placeholder="Mobile/Email"
            type="text"
            value={mobileEmail}
            onChange={(e) => {
              setMobileEmail(e.target.value);
            }}
            disabled={isLoading || otpSent}
            autoComplete="email"
            required
          />

          {otpSent && (
            <div className="space-y-2">
              <p className="text-sm text-text-secondary">
                OTP sent to {mobileEmail}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                fullWidth
                onClick={() => {
                  setOtpSent(false);
                  setShowOtpModal(false);
                  setOtp('');
                }}
                disabled={isLoading}
              >
                Change Mobile/Email
              </Button>
            </div>
          )}

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-secondary text-text-secondary">or login via</span>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <button
              type="button"
              onClick={() => handleSocialLogin('google')}
              disabled={isLoading || otpSent}
              className="flex flex-col items-center gap-2 p-4 border border-border rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Chrome className="w-8 h-8" />
              <span className="text-sm">Google</span>
            </button>
            <button
              type="button"
              onClick={() => handleSocialLogin('facebook')}
              disabled={isLoading || otpSent}
              className="flex flex-col items-center gap-2 p-4 border border-border rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Facebook className="w-8 h-8" />
              <span className="text-sm">Facebook</span>
            </button>
          </div>

          <Button 
            type="submit" 
            variant="primary" 
            size="lg" 
            fullWidth 
            className="mt-6"
            disabled={isLoading || otpSent}
          >
            {isLoading ? 'Sending...' : otpSent ? 'OTP Sent' : 'SEND OTP'}
          </Button>

          <div className="text-center">
            <p className="text-sm text-text-secondary">
              Don't have an account?{' '}
              <Link 
                href={`/signup${searchParams.get('redirect') ? `?redirect=${searchParams.get('redirect')}&from=${searchParams.get('from') || ''}&style=${searchParams.get('style') || ''}` : ''}`}
                className="text-primary hover:underline font-medium"
              >
                Sign up
              </Link>
            </p>
          </div>
        </form>
      </div>

      {/* OTP Modal */}
      <Modal
        isOpen={showOtpModal}
        onClose={() => {
          if (!isLoading) {
            setShowOtpModal(false);
          }
        }}
        title="Enter OTP"
        showCloseButton={!isLoading}
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            We've sent a 6-digit OTP to {mobileEmail}
          </p>

          <Input
            placeholder="000000"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={otp}
            onChange={(e) => {
              // Only allow digits
              const value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
              setOtp(value);
            }}
            maxLength={6}
            disabled={isLoading}
            className="text-center text-2xl tracking-widest font-mono"
            required
            autoFocus
          />

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="md"
              fullWidth
              onClick={() => {
                setShowOtpModal(false);
                setOtp('');
              }}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              fullWidth
              onClick={handleVerifyOtp}
              disabled={isLoading || otp.length !== 6}
            >
              {isLoading ? 'Verifying...' : 'Verify OTP'}
            </Button>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={handleSendOtp}
              disabled={isLoading}
              className="text-sm text-primary hover:underline disabled:opacity-50"
            >
              Resend OTP
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
