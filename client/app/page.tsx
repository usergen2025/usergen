'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import FeatureBadge from '@/components/ui/FeatureBadge';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import Image from 'next/image';
import GetStartedModal from '@/components/auth/GetStartedModal';
import BrandSignupModal from '@/components/auth/BrandSignupModal';
import CreatorSignupModal from '@/components/auth/CreatorSignupModal';
import LoginModal from '@/components/auth/LoginModal';

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [getStartedModalOpen, setGetStartedModalOpen] = useState(false);
  const [brandSignupModalOpen, setBrandSignupModalOpen] = useState(false);
  const [creatorSignupModalOpen, setCreatorSignupModalOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  const handleCreateVideoClick = () => {
    if (isAuthenticated) {
      router.push('/create-video/ai-chat');
    } else {
      // Set flag to indicate user came from "Create a Video" button
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('fromCreateVideo', 'true');
      }
      setGetStartedModalOpen(true);
    }
  };

  const handleSelectCreator = () => {
    setGetStartedModalOpen(false);
    setCreatorSignupModalOpen(true);
  };

  const handleSelectBrand = () => {
    setGetStartedModalOpen(false);
    setBrandSignupModalOpen(true);
  };

  const handleShowLogin = () => {
    setGetStartedModalOpen(false);
    setBrandSignupModalOpen(false);
    setCreatorSignupModalOpen(false);
    setLoginModalOpen(true);
  };

  const handleShowGetStarted = () => {
    setLoginModalOpen(false);
    setBrandSignupModalOpen(false);
    setCreatorSignupModalOpen(false);
    setGetStartedModalOpen(true);
  };

  const closeAllModals = () => {
    setLoginModalOpen(false);
    setGetStartedModalOpen(false);
    setBrandSignupModalOpen(false);
    setCreatorSignupModalOpen(false);
  };

  return (
    <div className="relative h-dvh bg-background overflow-y-auto overflow-x-hidden lg:overflow-hidden flex flex-col pt-[calc(43px+64px)]">
      {/* Gradient Ellipses Background — pinned to the viewport so the oversized
          blurs never add scrollable height to the page */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-[1146px] h-[1146px] left-[calc(50%+720px)] top-[calc(50%-512px)] bg-[#E86512] opacity-10 blur-[200px]" />
        <div className="absolute w-[1146px] h-[1146px] left-[calc(50%-720px)] top-[calc(50%+512px)] bg-[#E86512] opacity-10 blur-[200px]" />
      </div>

      <div className="relative container mx-auto px-4 flex-1 flex flex-col justify-center py-4 md:py-8 overflow-visible">
        {/* Social Proof Section */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-4 mb-4 md:mb-6">
          <Image 
            src="/assets/social-proof-avatars.svg" 
            alt="User avatars" 
            width={104} 
            height={32}
            className="w-[104px] h-[32px]"
          />
          <p className="font-sans text-sm md:text-base text-text-secondary">
            Supporting over +3,000,000 users worldwide
          </p>
        </div>

        {/* Hero Section */}
        <div className="flex flex-col items-center text-center mb-4 md:mb-6 overflow-visible">
          <h1 className={cn(
            typography.heading.h1,
            "max-w-4xl mb-3 md:mb-4 text-center text-3xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl"
          )}>
            Turn imagination into <span className="text-[#E86412]">impact</span> with UserGen
          </h1>
          
          {/* Large UserGen Text */}
          <div className="relative mb-3 md:mb-4 overflow-visible w-full">
            <div className="relative">
              <h2 className="font-heading text-[48px] md:text-[64px] lg:text-[72px] xl:text-[96px] font-normal leading-[1] text-black whitespace-nowrap">
                UserGen
              </h2>
              <div className="hidden md:block absolute left-[70.34%] right-[-49.74%] top-0 bottom-0 bg-[#FFFCF8] pointer-events-none" />
            </div>
          </div>

          {/* CTA Button */}
          <Button 
            variant="primary" 
            size="lg" 
            className="mb-3 md:mb-4"
            onClick={handleCreateVideoClick}
          >
            {isLoading ? 'Loading...' : (isAuthenticated ? 'CREATE A VIDEO NOW' : 'Create a your First Video')}
          </Button>

          {/* Tagline */}
          <p className="font-sans text-lg md:text-xl lg:text-2xl text-black mb-4 md:mb-6">
            Create. Transform. Stand Out.
          </p>
        </div>

        {/* Features Section */}
        <div className="flex flex-col items-center gap-4 md:gap-6">
          <p className="font-sans text-sm md:text-base text-text-secondary">
            Loaded with all the features at the click of a button...
          </p>

          {/* Feature Badges */}
          <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
            <FeatureBadge
              icon={
                <Image src="/assets/icon-video.svg" alt="Video" width={24} height={24} className="w-full h-full" />
              }
              label="Auto-Generated Videos"
            />
            <FeatureBadge
              icon={
                <Image src="/assets/icon-captions.svg" alt="Captions" width={24} height={24} className="w-full h-full" />
              }
              label="Captions"
            />
            <FeatureBadge
              icon={
                <Image src="/assets/icon-voice.svg" alt="Voice" width={24} height={24} className="w-full h-full" />
              }
              label="Voice Cloning"
            />
            <FeatureBadge
              icon={
                <Image src="/assets/icon-avatar.svg" alt="Avatar" width={24} height={24} className="w-full h-full" />
              }
              label="Hire an Avatar"
            />
            <FeatureBadge
              icon={
                <Image src="/assets/icon-script.svg" alt="Script" width={24} height={24} className="w-full h-full" />
              }
              label="Script Generation"
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      <GetStartedModal
        isOpen={getStartedModalOpen}
        onClose={closeAllModals}
        onSelectCreator={handleSelectCreator}
        onSelectBrand={handleSelectBrand}
        onShowLogin={handleShowLogin}
      />
      <CreatorSignupModal
        isOpen={creatorSignupModalOpen}
        onClose={closeAllModals}
        onShowLogin={handleShowLogin}
      />
      <BrandSignupModal
        isOpen={brandSignupModalOpen}
        onClose={closeAllModals}
        onShowLogin={handleShowLogin}
      />
      <LoginModal
        isOpen={loginModalOpen}
        onClose={closeAllModals}
        onShowGetStarted={handleShowGetStarted}
        redirectUrl="/"
      />
    </div>
  );
}
