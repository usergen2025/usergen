'use client';

import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';
import {
  AuthEmailInput,
  AuthField,
  AuthModalShell,
  AuthOtpInput,
  AuthSocialRow,
  AuthSwitchPrompt,
  AuthTextInput,
} from './AuthModalShell';

/** OTP endpoints surface their reason in `message`; anything else falls back. */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '';
}

interface CreatorSignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowLogin: () => void;
  redirectUrl?: string;
}

function CreatorSignupModalContent({ isOpen, onClose, onShowLogin, redirectUrl }: CreatorSignupModalProps) {
  const router = useRouter();
  const { login } = useAuth();
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    mobile: '',
  });
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const handleSendOtp = async () => {
    if (!formData.name.trim()) {
      showToast('Please enter your name', 'error');
      return;
    }
    if (!formData.email.trim()) {
      showToast('Please enter your email', 'error');
      return;
    }
    // TODO: Mobile field commented out for future use
    // if (!formData.mobile.trim()) {
    //   showToast('Please enter your mobile number', 'error');
    //   return;
    // }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    setIsLoading(true);

    try {
      await apiClient.sendOtp({
        email: formData.email.trim(),
        // mobile: formData.mobile.trim(), // TODO: Mobile field commented out for future use
        type: 'EMAIL_VERIFICATION',
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
        email: formData.email.trim(),
        otp,
        type: 'EMAIL_VERIFICATION',
        name: formData.name.trim(),
        // mobile: formData.mobile.trim(), // TODO: Mobile field commented out for future use
      });

      if (response.data?.tokens && response.data.tokens.accessToken) {
        login(response.data.tokens.accessToken);
        
        if (response.data.tokens.refreshToken) {
          localStorage.setItem('refreshToken', response.data.tokens.refreshToken);
        }

        showToast('Registration successful! Welcome to UserGen.ai', 'success');
        onClose();
        
        setTimeout(() => {
          const finalRedirectUrl = redirectUrl || sessionStorage.getItem('pendingRedirect') || '/create-video/style';
          const fromCreateVideo = typeof window !== 'undefined' && sessionStorage.getItem('fromCreateVideo') === 'true';
          
          // Clear the flag after checking
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('fromCreateVideo');
          }
          
          if (finalRedirectUrl.includes('/create-video')) {
            // If user came from "Create a Video" button, go to new chat flow
            if (fromCreateVideo) {
              router.push('/create-video/ai-chat');
            } else {
              // Otherwise, go to old style selection flow
              router.push('/create-video/style');
            }
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

  const handleSocialSignup = async (provider: 'google' | 'facebook') => {
    setIsLoading(true);
    try {
      await apiClient.socialLogin(provider);
    } catch (err: unknown) {
      showToast(errorMessage(err) || `Failed to sign up with ${provider}`, 'error');
      setIsLoading(false);
    }
  };

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim());
  const detailsComplete = Boolean(formData.name.trim()) && emailIsValid;

  return (
    <AuthModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Sign up as a Creator"
      subtitle="Join campaigns and get paid for the views you earn."
      footer={
        <>
          <button
            type="submit"
            form="auth-creator-signup-form"
            className="brand-cta-primary w-full"
            disabled={isLoading || (!otpSent && !detailsComplete) || (otpSent && otp.length !== 6)}
          >
            {isLoading
              ? otpSent
                ? 'Creating account…'
                : 'Sending…'
              : otpSent
                ? 'Create account'
                : 'Send OTP'}
          </button>
          <AuthSwitchPrompt
            question="Already have an account?"
            actionLabel="Login"
            onAction={onShowLogin}
          />
        </>
      }
    >
      <form
        id="auth-creator-signup-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!otpSent) handleSendOtp();
          else handleVerifyOtp();
        }}
        className="space-y-3.5"
      >
        <AuthField label="Name" htmlFor="auth-creator-name">
          <AuthTextInput
            id="auth-creator-name"
            type="text"
            placeholder="Your full name"
            autoComplete="name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={isLoading || otpSent}
          />
        </AuthField>

        <AuthField label="Email" htmlFor="auth-creator-email">
          <AuthEmailInput
            id="auth-creator-email"
            value={formData.email}
            onChange={(email) => setFormData({ ...formData, email })}
            onSend={handleSendOtp}
            canSend={detailsComplete && !isLoading}
            isSending={isLoading && !otpSent}
            disabled={isLoading || otpSent}
          />
        </AuthField>

        <AuthField label="One time password" htmlFor="auth-creator-otp">
          <AuthOtpInput
            id="auth-creator-otp"
            value={otp}
            onChange={setOtp}
            disabled={isLoading || !otpSent}
            autoFocus={otpSent}
          />
          <p className="brand-campaign-meta mt-1.5 text-[#616161]">
            {otpSent
              ? `Code sent to ${formData.email.trim()}. Tap send again to resend.`
              : 'Add your name and email, then tap send to get your code.'}
          </p>
        </AuthField>

        <AuthSocialRow onSelect={handleSocialSignup} disabled={isLoading || otpSent} />
      </form>
    </AuthModalShell>
  );
}

export default function CreatorSignupModal(props: CreatorSignupModalProps) {
  return (
    <Suspense fallback={null}>
      <CreatorSignupModalContent {...props} />
    </Suspense>
  );
}

