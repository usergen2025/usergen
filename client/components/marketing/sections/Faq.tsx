'use client';

import { useState } from 'react';
import ResponsiveCopy from '../ResponsiveCopy';
import { MarketingSection, MarketingSectionHeading } from '../MarketingSection';
import { landing } from '@/lib/content/landing';

/** How many answers the design shows before the "View all" control. */
const VISIBLE_COUNT = 2;

/**
 * The design shows the answers already open rather than as an accordion, so
 * they are plain cards.
 *
 * "View all" reveals the remaining entries in place. The design implies a
 * fuller FAQ page behind it, but none exists, and a button that navigates
 * nowhere is worse than one that does something useful with what we have.
 */
export default function Faq() {
  const { faq } = landing;
  const [expanded, setExpanded] = useState(false);
  const items = expanded ? faq.items : faq.items.slice(0, VISIBLE_COUNT);
  const hasMore = faq.items.length > VISIBLE_COUNT;

  return (
    <MarketingSection className="bg-white pt-16 md:pt-[84px]">
      <MarketingSectionHeading
        eyebrow={faq.eyebrow}
        lead={faq.headline.lead}
        trail={faq.headline.trail}
        eyebrowClassName="border-mkt-violet text-mkt-violet"
      />

      <ul className="mt-8 flex w-full max-w-[745px] flex-col gap-5 md:mt-[35px]">
        {items.map((item) => (
          <li key={item.question} className="rounded-[18px] bg-[#F2F2F2] p-6 md:p-8">
            <h3 className="font-mkt-sans text-[16px] leading-[22px] text-black">{item.question}</h3>
            <p className="mt-3 font-mkt-sans text-[14.5px] leading-[20px] text-[#333333]">
              <ResponsiveCopy value={item.answer} />
            </p>
          </li>
        ))}
      </ul>

      {hasMore && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-6 inline-flex h-[35px] items-center rounded-[10px] bg-[#EB544C] px-[18px] font-mkt-sans text-[13px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-coral"
        >
          {faq.viewAll}
        </button>
      ) : null}
    </MarketingSection>
  );
}
