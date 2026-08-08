'use client';

import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';
import { writeStorage } from '@/lib/utils/safeStorage';
import BrandLogoPicker from './BrandLogoPicker';
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

interface BrandSignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowLogin: () => void;
  redirectUrl?: string;
}

function BrandSignupModalContent({ isOpen, onClose, onShowLogin, redirectUrl }: BrandSignupModalProps) {
  const router = useRouter();
  const { login } = useAuth();
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    brandName: '',
    logo: '',
    brandDescription: '',
    email: '',
  });
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const handleSendOtp = async () => {
    if (!formData.brandName.trim()) {
      showToast('Please enter your brand name', 'error');
      return;
    }
    if (!formData.brandDescription.trim()) {
      showToast('Please enter your brand description', 'error');
      return;
    }
    if (!formData.email.trim()) {
      showToast('Please enter your email', 'error');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    setIsLoading(true);

    try {
      await apiClient.sendOtp({
        email: formData.email.trim(),
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
        name: formData.brandName.trim(),
        brandName: formData.brandName.trim(),
        brandDescription: formData.brandDescription.trim(),
        brandLogo: formData.logo.trim() || undefined,
        role: 'BRAND',
      });

      if (response.data?.tokens && response.data.tokens.accessToken) {
        const userData = response.data.user;
        login(response.data.tokens.accessToken, false, userData);
        
        if (response.data.tokens.refreshToken) {
          writeStorage('refreshToken', response.data.tokens.refreshToken);
        }

        showToast('Registration successful! Welcome to UserGen.ai FOR BRANDS', 'success');
        onClose();
        
        setTimeout(() => {
          // Redirect brands to brand dashboard
          const finalRedirectUrl = redirectUrl || sessionStorage.getItem('pendingRedirect') || '/brand/dashboard';
          router.push(finalRedirectUrl);
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
  const detailsComplete =
    Boolean(formData.brandName.trim()) && Boolean(formData.brandDescription.trim()) && emailIsValid;

  return (
    <AuthModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Sign up as a Brand"
      subtitle="Run campaigns and pay creators for the views they bring."
      widthClassName="max-w-[520px]"
      footer={
        <>
          <button
            type="submit"
            form="auth-brand-signup-form"
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
        id="auth-brand-signup-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!otpSent) handleSendOtp();
          else handleVerifyOtp();
        }}
        className="space-y-3.5"
      >
        <AuthField label="Brand name" htmlFor="auth-brand-name">
          <AuthTextInput
            id="auth-brand-name"
            type="text"
            placeholder="Enter your brand name"
            autoComplete="organization"
            required
            value={formData.brandName}
            onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
            disabled={isLoading || otpSent}
          />
        </AuthField>

        <AuthField label="Logo (optional)">
          <BrandLogoPicker
            value={formData.logo}
            onChange={(logo) => setFormData((prev) => ({ ...prev, logo }))}
            disabled={isLoading || otpSent}
          />
        </AuthField>

        <AuthField label="Brand description" htmlFor="auth-brand-description">
          <AuthTextInput
            id="auth-brand-description"
            type="text"
            placeholder="What does your brand do?"
            required
            value={formData.brandDescription}
            onChange={(e) => setFormData({ ...formData, brandDescription: e.target.value })}
            disabled={isLoading || otpSent}
          />
        </AuthField>

        <AuthField label="Email" htmlFor="auth-brand-email">
          <AuthEmailInput
            id="auth-brand-email"
            value={formData.email}
            onChange={(email) => setFormData({ ...formData, email })}
            onSend={handleSendOtp}
            canSend={detailsComplete && !isLoading}
            isSending={isLoading && !otpSent}
            disabled={isLoading || otpSent}
          />
        </AuthField>

        <AuthField label="One time password" htmlFor="auth-brand-otp">
          <AuthOtpInput
            id="auth-brand-otp"
            value={otp}
            onChange={setOtp}
            disabled={isLoading || !otpSent}
            autoFocus={otpSent}
          />
          <p className="brand-campaign-meta mt-1.5 text-[#616161]">
            {otpSent
              ? `Code sent to ${formData.email.trim()}. Tap send again to resend.`
              : 'Fill in your brand details, then tap send to get your code.'}
          </p>
        </AuthField>

        <AuthSocialRow onSelect={handleSocialSignup} disabled={isLoading || otpSent} />
      </form>
    </AuthModalShell>
  );
}

export default function BrandSignupModal(props: BrandSignupModalProps) {
  return (
    <Suspense fallback={null}>
      <BrandSignupModalContent {...props} />
    </Suspense>
  );
}

