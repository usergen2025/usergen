'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';
import { writeStorage } from '@/lib/utils/safeStorage';
import {
  AuthEmailInput,
  AuthField,
  AuthModalShell,
  AuthOtpInput,
  AuthSocialRow,
  AuthSwitchPrompt,
} from './AuthModalShell';

/** OTP endpoints surface their reason in `message`; anything else falls back. */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '';
}

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  redirectUrl?: string;
  onShowGetStarted?: () => void;
}

function LoginModalContent({ isOpen, onClose, redirectUrl, onShowGetStarted }: LoginModalProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const { showToast } = useToast();
  const [mobileEmail, setMobileEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const handleSendOtp = async () => {
    if (!mobileEmail.trim()) {
      showToast('Please enter your email', 'error');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(mobileEmail.trim())) {
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
        const userData = response.data.user;
        login(response.data.tokens.accessToken, false, userData);
        
        if (response.data.tokens.refreshToken) {
          writeStorage('refreshToken', response.data.tokens.refreshToken);
        }

        showToast('Login successful!', 'success');
        onClose();
        
        setTimeout(() => {
          // Determine redirect based on user role
          const userRole = userData?.role;
          let defaultRedirect = '/';
          
          if (userRole === 'BRAND') {
            defaultRedirect = '/brand/dashboard';
          } else if (userRole === 'USER' || userRole === 'AVATAR_CREATOR') {
            defaultRedirect = '/dashboard';
          }

          const finalRedirectUrl = redirectUrl || searchParams?.get('redirect') || sessionStorage.getItem('pendingRedirect') || defaultRedirect;
          
          // Clear fromCreateVideo flag after use
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('fromCreateVideo');
          }
          
          // Brands don't use create-video flow
          if (userRole === 'BRAND') {
            router.push(finalRedirectUrl);
          } else if (finalRedirectUrl.includes('/create-video')) {
            // Prefer ai-chat flow (AuthGuard overlay), not style
            router.push('/create-video/ai-chat');
          } else if (finalRedirectUrl === '/dashboard' || finalRedirectUrl === '/dashboard/projects') {
            router.push('/projects');
          } else {
            router.push(finalRedirectUrl);
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
      await apiClient.socialLogin(provider);
    } catch (err: unknown) {
      showToast(errorMessage(err) || `Failed to login with ${provider}`, 'error');
      setIsLoading(false);
    }
  };

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mobileEmail.trim());

  return (
    <AuthModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Login"
      subtitle="We'll email you a one time password."
      footer={
        <>
          <button
            type="submit"
            form="auth-login-form"
            className="brand-cta-primary w-full"
            disabled={isLoading || (!otpSent && !emailIsValid) || (otpSent && otp.length !== 6)}
          >
            {isLoading ? (otpSent ? 'Verifying…' : 'Sending…') : otpSent ? 'Login' : 'Send OTP'}
          </button>
          <AuthSwitchPrompt
            question="Don't have an account?"
            actionLabel="Sign up"
            onAction={() => {
              if (onShowGetStarted) {
                onShowGetStarted();
                return;
              }
              onClose();
              router.push('/signup');
            }}
          />
        </>
      }
    >
      <form
        id="auth-login-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!otpSent) handleSendOtp();
          else handleVerifyOtp();
        }}
        className="space-y-3.5"
      >
        <AuthField label="Email" htmlFor="auth-login-email">
          <AuthEmailInput
            id="auth-login-email"
            value={mobileEmail}
            onChange={setMobileEmail}
            onSend={handleSendOtp}
            canSend={emailIsValid && !isLoading}
            isSending={isLoading && !otpSent}
            disabled={isLoading || otpSent}
          />
        </AuthField>

        <AuthField label="One time password" htmlFor="auth-login-otp">
          <AuthOtpInput
            id="auth-login-otp"
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
      </form>
    </AuthModalShell>
  );
}


export default function LoginModal(props: LoginModalProps) {
  return (
    <Suspense fallback={null}>
      <LoginModalContent {...props} />
    </Suspense>
  );
}

