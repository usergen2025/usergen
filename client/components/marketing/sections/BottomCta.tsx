import { ArrowRight } from 'lucide-react';
import GetStartedButton from '../GetStartedButton';
import MarketingButton from '../MarketingButton';
import MarketingMedia from '../MarketingMedia';
import ResponsiveCopy from '../ResponsiveCopy';
import { WhatsAppIcon } from '../BrandIcons';
import { MKT_CONTAINER } from '../MarketingSection';
import { landing, WHATSAPP_NUMBER } from '@/lib/content/landing';

export default function BottomCta() {
  const { bottomCta } = landing;

  return (
    <section className="mt-16 bg-black md:mt-[84px]">
      <div className={`${MKT_CONTAINER} flex flex-col gap-10 py-14 md:flex-row md:items-center md:justify-between md:py-20`}>
        <div className="flex max-w-[501px] flex-col gap-6 md:gap-8">
          <h2 className="font-mkt-display text-2xl font-bold leading-[34px] tracking-[-0.02em] text-white md:text-[37px] md:leading-[42px]">
            {bottomCta.headline.lead}
            <br />
            {bottomCta.headline.trail}
          </h2>
          <p className="font-mkt-sans text-[15px] leading-6 text-[#BFC1D2] md:text-[15.5px]">
            <ResponsiveCopy value={bottomCta.subcopy} />
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:gap-3">
            <GetStartedButton className="max-md:w-full">
              {bottomCta.primary}
              <ArrowRight className="size-4" strokeWidth={2.5} />
            </GetStartedButton>

            {/*
             * Hidden until there is a number to open. The design shows the
             * button, but a wa.me link with no account behind it drops the
             * visitor on a WhatsApp error page — see WHATSAPP_NUMBER.
             */}
            {WHATSAPP_NUMBER ? (
              <MarketingButton
                variant="whatsapp"
                href={`https://wa.me/${WHATSAPP_NUMBER}`}
                target="_blank"
                rel="noreferrer noopener"
                icon={<WhatsAppIcon className="size-4 text-[#25D366]" />}
                className="max-md:w-full"
              >
                <ResponsiveCopy value={bottomCta.whatsapp} />
              </MarketingButton>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-4">
          <MarketingMedia
            media={bottomCta.media}
            className="h-[180px] w-full rounded-[10px] md:h-[242px] md:w-[354px]"
            sizes="(min-width: 768px) 354px, 100vw"
          />
        </div>
      </div>
      {/*
       * The frame also carries an oversized "UserGen.ai" wordmark across the
       * bottom of the page, but as a #3E3E3E-to-black gradient at 20% opacity
       * sitting behind this black panel — invisible as specified. Left out
       * rather than guessing at a placement that would make it show.
       */}
    </section>
  );
}
