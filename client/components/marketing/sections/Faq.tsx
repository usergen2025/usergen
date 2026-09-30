'use client';

import { useState } from 'react';
import ResponsiveCopy from '../ResponsiveCopy';
import { MarketingSection, MarketingSectionHeading } from '../MarketingSection';
import { landing } from '@/lib/content/landing';

/** How many questions are on screen before "View all". */
const VISIBLE_COUNT = 5;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`size-5 shrink-0 text-[#333333] transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Faq() {
  const { faq } = landing;
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const visible = showAll ? faq.items : faq.items.slice(0, VISIBLE_COUNT);
  const hasMore = faq.items.length > VISIBLE_COUNT;

  return (
    <MarketingSection id="faq" className="bg-white pt-16 md:pt-[84px]">
      <MarketingSectionHeading
        eyebrow={faq.eyebrow}
        lead={faq.headline.lead}
        trail={faq.headline.trail}
        eyebrowClassName="border-mkt-violet text-mkt-violet"
      />

      <ul className="mx-auto mt-8 flex w-full max-w-[745px] flex-col gap-5 md:mt-[35px]">
        {visible.map((item, index) => {
          const isOpen = open[index] === true;
          return (
            <li key={item.question} className="rounded-[18px] bg-[#F2F2F2] px-6 py-5 md:px-8 md:py-6">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((current) => ({ ...current, [index]: !current[index] }))}
                className="flex w-full items-center justify-between gap-4 text-left font-mkt-sans text-[16px] leading-[22px] text-black"
              >
                <span>{item.question}</span>
                <Chevron open={isOpen} />
              </button>
              {isOpen ? (
                <p className="mt-3 font-mkt-sans text-[14.5px] leading-[20px] text-[#333333]">
                  <ResponsiveCopy value={item.answer} />
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {hasMore && !showAll ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="inline-flex h-[35px] items-center rounded-[10px] bg-[#EB544C] px-[18px] font-mkt-sans text-[13px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-coral"
          >
            {faq.viewAll}
          </button>
        </div>
      ) : null}
    </MarketingSection>
  );
}
