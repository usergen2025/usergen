'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/lib/toast/toast';
import { apiClient } from '@/lib/api/client';
import { ArrowLeft } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  redirectUrl?: string;
  onShowGetStarted?: () => void;
}

function LoginModalContent({ isOpen, onClose, redirectUrl, onShowGetStarted }: LoginModalProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated } = useAuth();
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
        login(response.data.tokens.accessToken);
        
        if (response.data.tokens.refreshToken) {
          localStorage.setItem('refreshToken', response.data.tokens.refreshToken);
        }

        showToast('Login successful!', 'success');
        onClose();
        
        setTimeout(() => {
          const finalRedirectUrl = redirectUrl || searchParams?.get('redirect') || sessionStorage.getItem('pendingRedirect') || '/';
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
          } else if (finalRedirectUrl === '/dashboard' || finalRedirectUrl === '/dashboard/projects') {
            router.push('/projects');
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

  const handleSocialLogin = async (provider: 'google' | 'facebook') => {
    setIsLoading(true);
    try {
      await apiClient.socialLogin(provider);
    } catch (err: any) {
      showToast(err.message || `Failed to login with ${provider}`, 'error');
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-[546px] w-[546px] bg-white shadow-[0px_4px_22px_rgba(242,126,53,0.3)] rounded-xl"
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
            Login
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
          {/* Email Input with Send Icon */}
          <div className="flex flex-col items-start gap-1 w-full">
            <label className="font-heading font-light text-sm leading-[18px] text-[#616161]">
              Email
            </label>
            <div className="box-border flex flex-row items-center px-4 py-3 gap-2.5 w-full h-[52px] border-2 border-[#E0E0E0] rounded-xl">
              <input
                type="email"
                placeholder="Email"
                value={mobileEmail}
                onChange={(e) => setMobileEmail(e.target.value)}
                disabled={isLoading || otpSent}
                autoComplete="email"
                required
                className="flex-1 font-heading font-normal text-base leading-5 text-[#616161] placeholder:text-[#616161] bg-transparent border-0 outline-0 disabled:opacity-50"
              />
              {mobileEmail.trim() && !otpSent && (
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
          
          {/* OTP Input - Always visible */}
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
              onClick={() => handleSocialLogin('google')}
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
              onClick={() => handleSocialLogin('facebook')}
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
            disabled={isLoading || (!otpSent && !mobileEmail.trim()) || (otpSent && otp.length !== 6)}
          >
            {isLoading ? (otpSent ? 'Verifying...' : 'Sending...') : (otpSent ? 'Login' : 'SEND OTP')}
          </Button>

          <div className="text-center">
            <p className="text-sm text-text-secondary">
              Don't have an account?{' '}
              {onShowGetStarted ? (
                <button
                  onClick={onShowGetStarted}
                  className="text-primary hover:underline font-medium cursor-pointer"
                  type="button"
                >
                  Sign Up
                </button>
              ) : (
                <Link 
                  href="/signup"
                  className="text-primary hover:underline font-medium"
                  onClick={onClose}
                >
                  Sign up
                </Link>
              )}
            </p>
          </div>
        </form>
      </div>
    </Modal>
  );
}

export default function LoginModal(props: LoginModalProps) {
  return (
    <Suspense fallback={null}>
      <LoginModalContent {...props} />
    </Suspense>
  );
}

