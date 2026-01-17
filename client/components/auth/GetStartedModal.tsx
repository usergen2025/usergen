'use client';

import { Suspense } from 'react';
import Modal from '@/components/ui/Modal';
import { cn } from '@/lib/utils/cn';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';

interface GetStartedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCreator: () => void;
  onSelectBrand: () => void;
  onShowLogin: () => void;
}

function GetStartedModalContent({ 
  isOpen, 
  onClose, 
  onSelectCreator, 
  onSelectBrand,
  onShowLogin 
}: GetStartedModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-[546px] w-full bg-white shadow-[0px_4px_22px_rgba(242,126,53,0.3)] rounded-xl"
      showCloseButton={false}
    >
      <div className="flex flex-col items-center p-10 gap-10">
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
            Let's Get Started
          </h1>
          <div className="w-8 h-8" /> {/* Spacer for centering */}
        </div>

        {/* Option Cards */}
        <div className="flex flex-row items-start gap-5 w-full max-w-[324px]">
          {/* Creator Card */}
          <button
            onClick={onSelectCreator}
            className="flex flex-col justify-center items-center p-3.5 gap-2 flex-1 bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-xl cursor-pointer hover:opacity-90 transition-opacity min-w-[152px] h-[226px]"
            type="button"
          >
            <div className="flex flex-col justify-center items-center gap-1 w-full max-w-[125px]">
              <div className="box-border flex flex-row justify-center items-center w-full h-[170px] border border-white rounded-lg">
                <Image
                  src="/assets/creator-icon.svg"
                  alt="Creator"
                  width={125}
                  height={170}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex flex-row justify-center items-center gap-0.5 w-full h-6">
                <span className="font-heading font-normal text-base leading-6 text-center text-black">
                  I'm a Creator
                </span>
              </div>
            </div>
          </button>

          {/* Brand Card */}
          <button
            onClick={onSelectBrand}
            className="flex flex-col justify-center items-center p-3.5 gap-2 flex-1 bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-xl cursor-pointer hover:opacity-90 transition-opacity min-w-[152px] h-[226px]"
            type="button"
          >
            <div className="flex flex-col justify-center items-center gap-1 w-full max-w-[125px]">
              <div className="box-border flex flex-row justify-center items-center w-full h-[170px] border border-white rounded-lg">
                <Image
                  src="/assets/brand-icon.svg"
                  alt="Brand"
                  width={125}
                  height={170}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex flex-row justify-center items-center gap-0.5 w-full h-6">
                <span className="font-heading font-normal text-base leading-6 text-center text-black">
                  I'm a Brand
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* Already have an account link */}
        <div className="flex flex-row justify-center items-center w-full max-w-[316px] h-8">
          <span className="font-heading font-normal text-base leading-6 text-center text-black mr-2">
            Already have an account, proceed to
          </span>
          <button
            onClick={onShowLogin}
            className="font-heading font-medium text-base leading-4 text-center underline text-[#212121] cursor-pointer hover:opacity-70 transition-opacity"
            type="button"
          >
            Login
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function GetStartedModal(props: GetStartedModalProps) {
  return (
    <Suspense fallback={null}>
      <GetStartedModalContent {...props} />
    </Suspense>
  );
}

