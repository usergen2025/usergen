'use client';

import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';

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
        email: formData.email.trim(),
        otp,
        type: 'EMAIL_VERIFICATION',
        name: formData.brandName.trim(),
        // Note: Brand description and logo would be sent separately if backend supports it
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
    } catch (err: any) {
      showToast(err.message || 'Invalid OTP. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialSignup = async (provider: 'google' | 'facebook') => {
    setIsLoading(true);
    try {
      await apiClient.socialLogin(provider);
    } catch (err: any) {
      showToast(err.message || `Failed to sign up with ${provider}`, 'error');
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-[648px] w-full bg-white shadow-[0px_4px_22px_rgba(242,126,53,0.3)] rounded-xl"
      showCloseButton={false}
    >
      <div className="flex flex-col items-center p-10 gap-5">
        {/* Header with back arrow and title */}
        <div className="flex flex-row items-start w-full gap-2.5">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity"
            aria-label="Go back"
            type="button"
          >
            <ArrowLeft className="w-6 h-6 text-[#212121]" strokeWidth={1.5} />
          </button>
          <h1 className={cn(
            "flex-1 text-center font-heading font-normal text-[28px] leading-[28px] text-[#212121]"
          )}>
            Sign up as a Brand
          </h1>
          <div className="w-8 h-8" /> {/* Spacer for centering */}
        </div>

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (!otpSent) {
              handleSendOtp();
            } else {
              handleVerifyOtp();
            }
          }} 
          className="flex flex-col items-stretch w-full gap-5"
        >
          {/* Brand Name and Logo - Side by side */}
          <div className="flex flex-row items-start gap-1 w-full">
            {/* Brand Name */}
            <div className="flex flex-col items-start gap-1 flex-1">
              <label className="font-heading font-light text-sm leading-[18px] text-[#616161]">
                Brand Name
              </label>
              <div className="box-border flex flex-row items-start px-4 py-3 gap-2.5 w-full h-[52px] border-2 border-[#E0E0E0] rounded-xl">
                <input
                  type="text"
                  placeholder="Enter your Brand Name"
                  value={formData.brandName}
                  onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                  disabled={isLoading || otpSent}
                  required
                  className="flex-1 font-heading font-normal text-base leading-5 text-[#616161] placeholder:text-[#616161] bg-transparent border-0 outline-0 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Logo */}
            <div className="flex flex-col items-start gap-1 flex-1">
              <label className="font-heading font-light text-sm leading-[18px] text-[#616161]">
                Logo
              </label>
              <div className="box-border flex flex-row items-center px-4 py-3 gap-2.5 w-full h-[52px] border-2 border-[#E0E0E0] rounded-xl">
                <input
                  type="text"
                  placeholder="Attach a Logo"
                  value={formData.logo}
                  onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
                  disabled={isLoading || otpSent}
                  className="flex-1 font-heading font-normal text-base leading-5 text-[#616161] placeholder:text-[#616161] bg-transparent border-0 outline-0 disabled:opacity-50"
                />
                <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_paperclip.svg"
                    alt="Attach"
                    width={24}
                    height={24}
                    className="w-6 h-6"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Brand Description */}
          <div className="flex flex-col items-start gap-1 w-full">
            <label className="font-heading font-light text-sm leading-[18px] text-[#616161]">
              Brand Description
            </label>
            <div className="box-border flex flex-row items-start px-4 py-3 gap-2.5 w-full h-[52px] border-2 border-[#E0E0E0] rounded-xl">
              <input
                type="text"
                placeholder="Enter your Brand Description"
                value={formData.brandDescription}
                onChange={(e) => setFormData({ ...formData, brandDescription: e.target.value })}
                disabled={isLoading || otpSent}
                required
                className="flex-1 font-heading font-normal text-base leading-5 text-[#616161] placeholder:text-[#616161] bg-transparent border-0 outline-0 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Email Input */}
          <div className="flex flex-col items-start gap-1 w-full">
            <label className="font-heading font-light text-sm leading-[18px] text-[#616161]">
              Email
            </label>
            <div className="box-border flex flex-row items-center px-4 py-3 gap-2.5 w-full h-[52px] border-2 border-[#E0E0E0] rounded-xl">
              <input
                type="email"
                placeholder="Email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isLoading || otpSent}
                autoComplete="email"
                required
                className="flex-1 font-heading font-normal text-base leading-5 text-[#616161] placeholder:text-[#616161] bg-transparent border-0 outline-0 disabled:opacity-50"
              />
              {formData.email.trim() && !otpSent && (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={isLoading}
                  className="w-4 h-4 flex items-center justify-center flex-shrink-0 cursor-pointer disabled:opacity-50 hover:opacity-70 transition-opacity"
                >
                  <Image src="/assets/icon-send.svg" alt="Send OTP" width={16} height={16} />
                </button>
              )}
            </div>
          </div>

          {/* OTP Input */}
          <div className="flex flex-col items-start gap-1 w-full">
            <label className="font-heading font-light text-sm leading-[18px] text-[#616161]">
              One Time Password
            </label>
            <div className="box-border flex flex-row items-center px-4 py-3 gap-2.5 w-full h-[52px] border-2 border-[#E0E0E0] rounded-xl">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="------"
                value={otp}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                  setOtp(value);
                }}
                maxLength={6}
                disabled={isLoading || !otpSent}
                className="flex-1 font-heading font-normal text-[32px] leading-10 text-[#616161] placeholder:text-[#616161] bg-transparent border-0 outline-0 text-center tracking-widest disabled:opacity-50"
                required
                autoFocus={otpSent}
              />
            </div>
          </div>

          {/* Social Login Section */}
          <div className="flex flex-row items-start gap-0 w-[252px] h-14 mx-auto">
            <button
              type="button"
              onClick={() => handleSocialSignup('google')}
              disabled={isLoading || otpSent}
              className="flex flex-col justify-center items-center py-2 flex-1 h-14 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-70 transition-opacity"
            >
              <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                <Image src="/assets/icon-google.svg" alt="Google" width={24} height={24} className="w-full h-full" />
              </div>
              <span className="font-heading font-normal text-sm leading-4 text-[#212121] mt-1">Google</span>
            </button>
            <button
              type="button"
              onClick={() => handleSocialSignup('facebook')}
              disabled={isLoading || otpSent}
              className="flex flex-col justify-center items-center py-2 flex-1 h-14 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-70 transition-opacity"
            >
              <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                <Image src="/assets/icon-facebook.svg" alt="Facebook" width={24} height={24} className="w-full h-full" />
              </div>
              <span className="font-heading font-normal text-sm leading-4 text-[#212121] mt-1">Facebook</span>
            </button>
          </div>

          {/* Submit Button */}
          <Button 
            type="submit" 
            variant="primary" 
            size="lg" 
            className="w-[150px] min-w-[150px] max-w-[358px] h-[52px] mx-auto mt-0"
            disabled={isLoading || (!otpSent && (!formData.brandName.trim() || !formData.email.trim() || !formData.brandDescription.trim())) || (otpSent && otp.length !== 6)}
          >
            {isLoading ? (otpSent ? 'Verifying...' : 'Sending...') : (otpSent ? 'Login' : 'SEND OTP')}
          </Button>

          {/* Login link */}
          <div className="text-center">
            <p className="text-sm text-text-secondary">
              Already have an account?{' '}
              <button
                onClick={onShowLogin}
                className="text-primary hover:underline font-medium cursor-pointer"
                type="button"
              >
                Login
              </button>
            </p>
          </div>
        </form>
      </div>
    </Modal>
  );
}

export default function BrandSignupModal(props: BrandSignupModalProps) {
  return (
    <Suspense fallback={null}>
      <BrandSignupModalContent {...props} />
    </Suspense>
  );
}

