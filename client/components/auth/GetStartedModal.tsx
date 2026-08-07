'use client';

import { Suspense } from 'react';
import Image from 'next/image';
import { AuthModalShell, AuthSwitchPrompt } from './AuthModalShell';

interface GetStartedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCreator: () => void;
  onSelectBrand: () => void;
  onShowLogin: () => void;
}

const OPTIONS = [
  {
    id: 'creator',
    label: "I'm a Creator",
    blurb: 'Make videos, join campaigns, earn on views.',
    icon: '/assets/creator-icon.svg',
  },
  {
    id: 'brand',
    label: "I'm a Brand",
    blurb: 'Launch campaigns and reach real audiences.',
    icon: '/assets/brand-icon.svg',
  },
] as const;

function GetStartedModalContent({
  isOpen,
  onClose,
  onSelectCreator,
  onSelectBrand,
  onShowLogin,
}: GetStartedModalProps) {
  return (
    <AuthModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Let's get started"
      subtitle="Pick the account that fits how you'll use UserGen."
      footer={
        <AuthSwitchPrompt
          question="Already have an account?"
          actionLabel="Login"
          onAction={onShowLogin}
        />
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={option.id === 'creator' ? onSelectCreator : onSelectBrand}
            className="group flex flex-col items-center gap-2 rounded-[16px] border border-[#E8E2DB] bg-white p-3 text-center transition-all hover:border-[#E86512] hover:shadow-[0_6px_18px_rgba(232,100,18,0.14)]"
          >
            <div className="flex w-full items-center justify-center overflow-hidden rounded-[12px] bg-[#FFFAF6]">
              <Image
                src={option.icon}
                alt=""
                width={125}
                height={170}
                className="h-[clamp(96px,18vh,150px)] w-auto object-contain"
              />
            </div>
            <span className="font-heading text-[15px] font-medium text-[#212121]">
              {option.label}
            </span>
            <span className="brand-campaign-meta text-[#616161]">{option.blurb}</span>
          </button>
        ))}
      </div>
    </AuthModalShell>
  );
}

export default function GetStartedModal(props: GetStartedModalProps) {
  return (
    <Suspense fallback={null}>
      <GetStartedModalContent {...props} />
    </Suspense>
  );
}
