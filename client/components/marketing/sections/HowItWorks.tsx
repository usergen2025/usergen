import PlaceholderMedia from '../PlaceholderMedia';
import { MarketingSection, MarketingSectionHeading } from '../MarketingSection';
import { landing } from '@/lib/content/landing';

export default function HowItWorks() {
  const { howItWorks } = landing;

  return (
    <MarketingSection className="bg-white pt-16 md:pt-[84px]">
      <MarketingSectionHeading
        eyebrow={howItWorks.eyebrow}
        lead={howItWorks.headline.lead}
        trail={howItWorks.headline.trail}
      />

      <ol className="mt-10 grid gap-6 md:mt-[75px] md:grid-cols-3 md:gap-8">
        {howItWorks.steps.map((step) => (
          <li key={step.label} className="flex flex-col gap-5">
            <PlaceholderMedia className="h-[220px] w-full rounded-[10px] md:h-[242px]" />
            {/* The step number is a violet chip, the one place violet appears
                outside the translation section. */}
            <span className="inline-flex h-[35px] w-fit items-center rounded-[10px] bg-mkt-violet px-[11px] font-mkt-display text-base font-bold uppercase tracking-[0.009em] text-white">
              {step.label}
            </span>
            <h3 className="font-mkt-display text-[20px] font-bold leading-[28px] text-mkt-ink md:text-[22px]">
              {step.title}
            </h3>
            <p className="font-mkt-sans text-[15px] leading-[24px] text-mkt-muted md:text-[16px] md:leading-[26px]">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </MarketingSection>
  );
}
