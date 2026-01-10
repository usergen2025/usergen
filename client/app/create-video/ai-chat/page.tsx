'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import { apiClient, User } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';

// Define chat flow steps
type ChatStep = 'welcome' | 'option-selected' | 'asset-upload';

function AIChatPageContent() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<ChatStep>('welcome');
  const [showAddAssetsModal, setShowAddAssetsModal] = useState(false);

  // Fetch user profile when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      apiClient.getProfile()
        .then((response) => {
          if (response.data) {
            setUser(response.data);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch user profile:', err);
        });
    }
  }, [isAuthenticated]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      sessionStorage.setItem('pendingRedirect', '/create-video/ai-chat');
      router.replace('/login?redirect=/create-video/ai-chat');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleOptionClick = (option: string) => {
    setSelectedOption(option);
    setCurrentStep('option-selected');
    // Auto-advance to asset upload after a short delay
    setTimeout(() => {
      setCurrentStep('asset-upload');
    }, 1000);
  };

  const handleAddAssets = () => {
    setShowAddAssetsModal(true);
  };

  const handleSkipAssets = () => {
    // After completing the chat flow, redirect to style selection
    router.push('/create-video/style');
  };

  const handleCloseModal = () => {
    setShowAddAssetsModal(false);
  };

  const handleAttachAssets = () => {
    // Handle asset attachment logic here
    setShowAddAssetsModal(false);
    // After assets are attached, continue to style selection
    router.push('/create-video/style');
  };

  const handleBack = () => {
    if (currentStep === 'welcome') {
      router.push('/');
    } else if (currentStep === 'option-selected') {
      setCurrentStep('welcome');
      setSelectedOption(null);
    } else if (currentStep === 'asset-upload') {
      setCurrentStep('option-selected');
    }
  };

  const getOptionLabel = (option: string) => {
    switch(option) {
      case 'ad': return 'Create an ad';
      case 'promo': return 'Create a promo video';
      case 'tutorial': return 'Create a tutorial';
      case 'ai-clip': return 'Create an AI clip';
      default: return 'Create a video';
    }
  };

  const getProgressStep = () => {
    switch(currentStep) {
      case 'welcome': return 0;
      case 'option-selected': return 1;
      case 'asset-upload': return 1;
      default: return 0;
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-[#FFFCF8] flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const userName = user?.name || 'User';
  const firstName = userName.split(' ')[0];
  const progressStep = getProgressStep();

  return (
    <div className="relative h-full bg-[#FFFCF8] overflow-hidden flex flex-col">
      {/* Gradient Ellipses Background - Exact Figma positions */}
      <div className="absolute w-[1146px] h-[1146px] left-[calc(50%+720px)] top-[calc(50%-512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />
      <div className="absolute w-[1146px] h-[1146px] left-[calc(50%-720px)] top-[calc(50%+512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />

      {/* Main Container - Figma: width: 1248px, left: 96px, top: 43px */}
      <div className="relative max-w-[1248px] w-full mx-auto px-3 sm:px-6 md:px-[96px] pt-0 sm:pt-2 md:pt-[43px] pb-0 sm:pb-2 md:pb-[43px] flex flex-col flex-1 min-h-0">
        {/* Navigation Bar - Figma: height: 34px, gap: 20px between back arrow and "AI Chat" */}
        <div className="flex flex-row justify-between items-center mb-0 sm:mb-2 md:mb-[24px] h-[clamp(20px,3.3vh,34px)] flex-shrink-0">
          {/* Left: Back Arrow + AI Chat - Figma: gap: 20px */}
          <div className="flex flex-row items-center gap-[clamp(0.75rem,2vh,20px)] min-w-[90px] sm:min-w-[110px] md:min-w-[125px]">
            <button
              onClick={handleBack}
              className="flex items-center justify-center w-[clamp(16px,2.34vh,24px)] h-[clamp(16px,2.34vh,24px)] cursor-pointer hover:opacity-80 transition-opacity"
            >
              <ArrowLeft className="w-full h-full text-[#212121]" strokeWidth={1.5} />
            </button>
            {/* Figma: font: 24px, line-height: 24px */}
            <h2 className="font-heading text-[clamp(14px,2.34vh,24px)] font-medium leading-[clamp(14px,2.34vh,24px)] text-[#212121]">AI Chat</h2>
          </div>

          {/* Right: Stepper - Figma: width: 448px, height: 34px, gap: 6px */}
          <div className="flex flex-row items-center gap-0 pl-1 sm:pl-2 md:pl-2 max-w-[200px] sm:max-w-[300px] md:max-w-[400px] lg:max-w-[448px] w-full">
            <div className="flex flex-col justify-between items-start gap-0.5 sm:gap-1 md:gap-1 w-full max-w-[180px] sm:max-w-[280px] md:max-w-[380px] lg:max-w-[440px] h-[clamp(20px,3.3vh,34px)]">
              {/* Figma: height: 24px, gap: 10px, font: 14px, line-height: 24px */}
              <div className="flex flex-row justify-between items-center gap-[clamp(0.5rem,1vh,10px)] w-full h-[clamp(18px,2.34vh,24px)]">
                <span className="font-heading text-[clamp(10px,1.37vh,14px)] font-normal leading-[clamp(18px,2.34vh,24px)] text-black truncate">
                  {currentStep === 'welcome' ? "Let's kick things off!" : "Upload your visuals so I can shape your video."}
                </span>
                <span className="font-heading text-[clamp(10px,1.37vh,14px)] font-normal leading-[clamp(18px,2.34vh,24px)] text-black text-center min-w-[16px] sm:min-w-[18px] md:min-w-[19px]">
                  {progressStep}/6
                </span>
              </div>
              {/* Figma: height: 10px, gap: 6px */}
              <div className="flex flex-row items-center gap-[clamp(0.25rem,0.6vh,6px)] w-full h-[clamp(6px,0.98vh,10px)]">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex flex-col items-start h-[clamp(6px,0.98vh,10px)] flex-1 rounded-[5px]",
                      index === progressStep 
                        ? "bg-[#E86412]" 
                        : "bg-white border border-[#E0E0E0]"
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Chat Window - Figma: padding: 52px 56px, gap: 20px, border-radius: 12px */}
        <div className="bg-white shadow-[0px_4px_22px_rgba(102,118,108,0.12)] rounded-xl py-[clamp(1rem,5.1vh,52px)] px-[clamp(0.75rem,5.5vh,56px)] flex flex-col justify-start items-start gap-[clamp(0.5rem,1.95vh,20px)] flex-1 min-h-0 overflow-hidden">
          {/* Chat Content Container - Figma: gap: 18px, justify-content: flex-end */}
          <div className="flex flex-col justify-start items-start gap-[clamp(0.5rem,1.76vh,18px)] w-full flex-1 min-h-0 overflow-y-auto">
            {/* Welcome Message - Step 0 - Figma: gap: 10px */}
            {currentStep === 'welcome' && (
              <div className="flex flex-col justify-center items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px]">
                {/* AI Icon - Figma: 64px x 64px */}
                <div className="w-[clamp(2rem,6.25vh,64px)] h-[clamp(2rem,6.25vh,64px)]">
                  <Image
                    src="/assets/mingcute_ai-line.svg"
                    alt="AI"
                    width={64}
                    height={64}
                    className="w-full h-full"
                  />
                </div>
                
                {/* Welcome Text - Figma: font: 48px, line-height: 48px */}
                <h1 className="font-heading text-[clamp(1.5rem,4.69vh,48px)] font-medium leading-[clamp(1.5rem,4.69vh,48px)] text-[#212121] max-w-full sm:max-w-[597px]">
                  Hey {firstName}
                  <br />
                  Welcome to UserGen
                </h1>
                
                {/* Body Text - Figma: font: 18px, line-height: 21px */}
                <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[428px]">
                  Your creative studio powered by AI.
                  <br />
                  So, tell me... what kind of video are we making today?
                </p>
              </div>
            )}

            {/* Option Selected - Step 1 */}
            {currentStep === 'option-selected' && (
              <>
                <div className="flex flex-col justify-center items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px]">
                  {/* AI Icon - Figma: 64px x 64px */}
                  <div className="w-[clamp(2rem,6.25vh,64px)] h-[clamp(2rem,6.25vh,64px)]">
                    <Image
                      src="/assets/mingcute_ai-line.svg"
                      alt="AI"
                      width={64}
                      height={64}
                      className="w-full h-full"
                    />
                  </div>
                  
                  {/* Welcome Text - Figma: font: 48px, line-height: 48px */}
                  <h1 className="font-heading text-[clamp(1.5rem,4.69vh,48px)] font-medium leading-[clamp(1.5rem,4.69vh,48px)] text-[#212121] max-w-full sm:max-w-[597px]">
                    Hey {firstName}
                    <br />
                    Welcome to UserGen
                  </h1>
                  
                  {/* Body Text - Figma: font: 18px, line-height: 21px */}
                  <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[428px]">
                    Your creative studio powered by AI.
                    <br />
                    So, tell me... what kind of video are we making today?
                  </p>
                </div>
                
                {/* User Response - Figma: width: 275px, height: 42px, padding: 12px 16px, font: 18px, line-height: 18px, border-radius: 20px, gap: 10px */}
                <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                  <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(200px,26.9vw,275px)]">
                    <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(0.875rem,1.76vh,18px)] text-black text-right">
                      I want to {selectedOption === 'promo' ? 'create a promo video' : getOptionLabel(selectedOption || '').toLowerCase()}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Asset Upload - Step 1 continued */}
            {currentStep === 'asset-upload' && (
              <>
                <div className="flex flex-col justify-center items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px]">
                  {/* AI Icon - Figma: 64px x 64px */}
                  <div className="w-[clamp(2rem,6.25vh,64px)] h-[clamp(2rem,6.25vh,64px)]">
                    <Image
                      src="/assets/mingcute_ai-line.svg"
                      alt="AI"
                      width={64}
                      height={64}
                      className="w-full h-full"
                    />
                  </div>
                  
                  {/* Welcome Text - Figma: font: 48px, line-height: 48px */}
                  <h1 className="font-heading text-[clamp(1.5rem,4.69vh,48px)] font-medium leading-[clamp(1.5rem,4.69vh,48px)] text-[#212121] max-w-full sm:max-w-[597px]">
                    Hey {firstName}
                    <br />
                    Welcome to UserGen
                  </h1>
                  
                  {/* Body Text - Figma: font: 18px, line-height: 21px */}
                  <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[428px]">
                    Your creative studio powered by AI.
                    <br />
                    So, tell me... what kind of video are we making today?
                  </p>
                </div>
                
                {/* User Response - Figma: width: 275px, height: 42px, padding: 12px 16px, font: 18px, line-height: 18px, border-radius: 20px, gap: 10px */}
                <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                  <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(200px,26.9vw,275px)]">
                    <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(0.875rem,1.76vh,18px)] text-black text-right">
                      I want to {selectedOption === 'promo' ? 'create a promo video' : getOptionLabel(selectedOption || '').toLowerCase()}
                    </span>
                  </div>
                </div>

                {/* Asset Upload Section - Figma: width: 459px, gap: 8px */}
                <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] w-full max-w-full sm:max-w-[459px]">
                  {/* Figma: font: 18px, line-height: 21px */}
                  <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                    Add in your video assets to help us create your video...
                  </p>
                  
                  {/* AI Recommendation Box - Figma: padding: 8px 16px, border-radius: 24px, width: 459px, height: 108px, border: 2px gradient */}
                  <div className="relative w-full rounded-[24px] p-[2px] bg-gradient-to-r from-[rgba(255,211,183,1)] to-[rgba(246,166,166,1)]">
                    <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[22px] py-[clamp(0.5rem,0.78vh,8px)] px-[clamp(1rem,1.56vh,16px)] w-full flex flex-col justify-center items-start gap-[clamp(0.5rem,0.78vh,8px)]">
                      {/* Figma: gap: 10px, height: 21px */}
                      <div className="flex flex-row items-center gap-[clamp(0.625rem,0.98vh,10px)] w-full">
                        {/* Figma: 16px x 16px */}
                        <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex-shrink-0">
                          <Image
                            src="/assets/mingcute_ai-line-1.svg"
                            alt="AI"
                            width={16}
                            height={16}
                            className="w-full h-full"
                          />
                        </div>
                        {/* Figma: font: 16px, line-height: 21px, gradient text */}
                        <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(1.3125rem,2.05vh,21px)] bg-gradient-to-b from-[#E86412] to-[#F12A4C] bg-clip-text text-transparent">
                          AI recommendation
                        </span>
                      </div>
                      {/* Figma: font: 16px, line-height: 21px, width: 427px (459 - 32px padding) */}
                      <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1.3125rem,2.05vh,21px)] text-[#212121] w-full">
                        Attach your brand logo, product images and your company URL from Add Assets button so we can create a video specialized to your needs.
                      </p>
                    </div>
                  </div>
                  
                  {/* Skip this step - Outside the recommendation box */}
                  <button
                    onClick={handleSkipAssets}
                    className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1.75rem,2.73vh,28px)] text-transparent bg-gradient-to-b from-[#E86412] to-[#F12A4C] bg-clip-text underline self-start"
                  >
                    Skip this step
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Add Assets Input Bar - Figma: height: 68px, padding: 8px 12px, gap: 16px, border-radius: 30px */}
          {/* KEY FIX: Add margin-top and margin-bottom to create gap from content above and below */}
          {currentStep === 'asset-upload' && (
            <div className="flex flex-row justify-center items-center gap-[clamp(0.75rem,1.56vh,16px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] w-full h-[clamp(2.5rem,6.64vh,68px)] flex-shrink-0 mt-auto mb-0">
            {/* Add Assets Button - Figma: width: 152px, height: 44px, padding: 8px 16px, border-radius: 24px */}
            <button
              onClick={handleAddAssets}
              className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(1rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[24px] h-[clamp(2rem,4.3vh,44px)]"
            >
              {/* Plus Icon - Figma: 24px x 24px */}
              <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)]">
                <Image
                  src="/assets/u_plus-circle.svg"
                  alt="Add"
                  width={24}
                  height={24}
                  className="w-full h-full"
                />
              </div>
              {/* Figma: font: 18px, line-height: 28px */}
              <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1.25rem,2.73vh,28px)] text-[#212121]">Add Assets</span>
            </button>
            {/* Figma: font: 16px, line-height: 21px */}
            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] flex-1 truncate">
              Supports files type .png & .jpg only of max 5 MB each.
            </span>
            {/* Send Button - Figma: width: 52px, height: 52px, border-radius: 26px */}
            <button className="flex flex-row justify-center items-center w-[clamp(2rem,5.08vh,52px)] h-[clamp(2rem,5.08vh,52px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px]">
              <Image
                src="/assets/fi_send.svg"
                alt="Send"
                width={24}
                height={24}
                className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)]"
              />
            </button>
          </div>
          )}

          {/* Suggested Actions - Only show on welcome step - Height responsive */}
          {currentStep === 'welcome' && (
            <div className="flex flex-row items-start gap-[clamp(0.25rem,0.5vh,8px)] w-full h-[clamp(2rem,4.2vh,42px)] flex-wrap md:flex-nowrap flex-shrink-0 mt-auto">
              {/* Create an ad */}
              <button
                onClick={() => handleOptionClick('ad')}
                className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.5vh,8px)] px-[clamp(0.5rem,1vh,12px)] py-[clamp(0.25rem,0.5vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[clamp(18px,2.34vh,30px)] flex-1 h-[clamp(2rem,4.2vh,42px)] hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-[clamp(0.875rem,1.56vh,16px)] h-[clamp(0.875rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_money-bill.svg"
                    alt="Money"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] truncate">Create an ad</span>
              </button>

              {/* Create a promo video */}
              <button
                onClick={() => handleOptionClick('promo')}
                className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.5vh,8px)] px-[clamp(0.5rem,1vh,12px)] py-[clamp(0.25rem,0.5vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[clamp(18px,2.34vh,30px)] flex-1 h-[clamp(2rem,4.2vh,42px)] hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-[clamp(0.875rem,1.56vh,16px)] h-[clamp(0.875rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_megaphone.svg"
                    alt="Megaphone"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] truncate">Create a promo video</span>
              </button>

              {/* Create a tutorial */}
              <button
                onClick={() => handleOptionClick('tutorial')}
                className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.5vh,8px)] px-[clamp(0.5rem,1vh,12px)] py-[clamp(0.25rem,0.5vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[clamp(18px,2.34vh,30px)] flex-1 h-[clamp(2rem,4.2vh,42px)] hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-[clamp(0.875rem,1.56vh,16px)] h-[clamp(0.875rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_lightbulb-alt.svg"
                    alt="Lightbulb"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] truncate">Create a tutorial</span>
              </button>

              {/* Create an AI clip */}
              <button
                onClick={() => handleOptionClick('ai-clip')}
                className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.5vh,8px)] px-[clamp(0.5rem,1vh,12px)] py-[clamp(0.25rem,0.5vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[clamp(18px,2.34vh,30px)] flex-1 h-[clamp(2rem,4.2vh,42px)] hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-[clamp(0.875rem,1.56vh,16px)] h-[clamp(0.875rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/mingcute_ai-line-1.svg"
                    alt="AI"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] truncate">Create an AI clip</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Assets Modal - Desktop 164 */}
      {showAddAssetsModal && (
        <>
          {/* Overlay */}
          <div 
            className="fixed inset-0 bg-gradient-to-br from-[rgba(191,143,100,0.5)] to-[rgba(179,104,56,0.5)] opacity-90 z-40"
            onClick={handleCloseModal}
          />
          
          {/* Modal */}
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white shadow-[0px_4px_22px_rgba(242,126,53,0.3)] rounded-xl p-10 w-full max-w-[546px] flex flex-col gap-5">
              {/* Modal Header */}
              <div className="flex flex-row items-start w-full">
                <h2 className="font-heading text-[28px] font-normal leading-7 text-[#212121] flex-1">Add Assets</h2>
                <button
                  onClick={handleCloseModal}
                  className="w-8 h-8 flex items-center justify-center"
                >
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 8L24 24M24 8L8 24" stroke="#212121" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Form Fields */}
              <div className="flex flex-col gap-4">
                {/* Attach Logo */}
                <div className="flex flex-col gap-1">
                  <div className="flex flex-row items-start gap-2.5 px-4 py-3 border-2 border-[#E0E0E0] rounded-xl h-[52px]">
                    <input
                      type="text"
                      placeholder="Attach Logo"
                      className="flex-1 font-heading text-base font-normal leading-5 text-[#616161] outline-none"
                    />
                    <div className="w-6 h-6 flex items-center justify-center">
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

                {/* Product Images */}
                <div className="flex flex-col gap-1">
                  <div className="flex flex-row items-start gap-2.5 px-4 py-3 border-2 border-[#E0E0E0] rounded-xl h-[52px]">
                    <input
                      type="text"
                      placeholder="Product Images"
                      className="flex-1 font-heading text-base font-normal leading-5 text-[#616161] outline-none"
                    />
                    <div className="w-6 h-6 flex items-center justify-center">
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

                {/* Type URL */}
                <div className="flex flex-col gap-1">
                  <div className="flex flex-row items-start gap-2.5 px-4 py-3 border-2 border-[#E0E0E0] rounded-xl h-[52px]">
                    <div className="w-6 h-6 flex items-center justify-center">
                      <Image
                        src="/assets/u_link.svg"
                        alt="Link"
                        width={24}
                        height={24}
                        className="w-6 h-6"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Type URL"
                      className="flex-1 font-heading text-base font-normal leading-5 text-[#616161] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Attach Button */}
              <button
                onClick={handleAttachAssets}
                className="flex flex-row justify-center items-center px-5 py-4 bg-[#FFD3B7] rounded-[26px] h-[52px] min-w-[150px]"
              >
                <span className="font-heading text-base font-semibold leading-4 text-[#616161]">Attach</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AIChatPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#FFFCF8] flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    }>
      <AIChatPageContent />
    </Suspense>
  );
}

