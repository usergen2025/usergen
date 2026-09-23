import { Info } from 'lucide-react';
import { MarketingSection, MarketingSectionHeading } from '../MarketingSection';
import { landing } from '@/lib/content/landing';
import { cn } from '@/lib/utils/cn';

/**
 * What an ad costs elsewhere versus here.
 *
 * A real `<table>` on desktop, because that is what it is — four labelled
 * columns of comparable values, which a screen reader should announce with
 * their headers. Below that it becomes a stacked list of cards: the mobile
 * frame drops the header row and inlines the turnaround as "TAT: 2-3 weeks",
 * which a table cannot do without leaving empty headers behind.
 *
 * The switch is at 1024px rather than 768: four columns in 720px wraps both
 * price ranges and the revisions text, which is exactly the comparison the
 * section exists to make legible.
 */
export default function CostComparison() {
  const { costComparison } = landing;

  return (
    <MarketingSection className="bg-white pt-16 md:pt-[84px]">
      <MarketingSectionHeading
        eyebrow={costComparison.eyebrow}
        lead={costComparison.headline.lead}
        trail={costComparison.headline.trail}
      />

      <div className="mt-8 w-full md:mt-[75px]">
        <table className="hidden w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-[#E5E5E5] lg:table">
          <thead>
            <tr>
              {[
                costComparison.columns.option,
                costComparison.columns.cost,
                costComparison.columns.turnaround,
                costComparison.columns.revisions,
              ].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="bg-[#F1F1F1] px-6 py-5 text-left font-mkt-sans text-[13.5px] font-bold text-mkt-muted"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {costComparison.rows.map((row) => (
              <tr
                key={row.option}
                className={cn(
                  row.highlight &&
                    'mkt-gradient-cta [&>td]:border-y-2 [&>td]:border-mkt-amber [&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2'
                )}
              >
                <td
                  className={cn(
                    'px-6 py-5 font-mkt-sans text-[17px]',
                    row.highlight ? 'font-bold text-white' : 'text-mkt-ink'
                  )}
                >
                  {row.option}
                </td>
                <td
                  className={cn(
                    'px-6 py-5 font-mkt-price text-[20px] font-extrabold',
                    row.highlight ? 'text-[#DAF5B7]' : 'text-mkt-ink'
                  )}
                >
                  {row.cost}
                </td>
                <td
                  className={cn(
                    'px-6 py-5 font-mkt-sans text-[17px]',
                    row.highlight ? 'font-bold text-white' : 'text-mkt-ink'
                  )}
                >
                  {row.turnaround}
                </td>
                <td
                  className={cn(
                    'px-6 py-5 font-mkt-sans text-[17px]',
                    row.highlight ? 'font-bold text-white' : 'text-mkt-ink'
                  )}
                >
                  {row.revisions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="flex flex-col gap-3 lg:hidden">
          {costComparison.rows.map((row) => (
            <li
              key={row.option}
              className={cn(
                'flex items-center justify-between gap-3 rounded-[10px] border p-4',
                row.highlight
                  ? 'mkt-gradient-cta border-2 border-mkt-amber'
                  : 'border-[#E5E5E5] bg-white'
              )}
            >
              <div>
                <p
                  className={cn(
                    'font-mkt-sans text-[15px]',
                    row.highlight ? 'font-bold text-white' : 'text-mkt-ink'
                  )}
                >
                  {row.option}
                </p>
                {/* The mobile frame lists the turnaround only, but dropping
                    the revisions column loses half of what the comparison is
                    making — both are kept, inlined. */}
                <p
                  className={cn(
                    'mt-1 font-mkt-sans text-[12.5px]',
                    row.highlight ? 'text-white/80' : 'text-mkt-muted'
                  )}
                >
                  TAT: {row.turnaround} · {row.revisions}
                </p>
              </div>
              <p
                className={cn(
                  'shrink-0 font-mkt-price text-[18px] font-extrabold',
                  row.highlight ? 'text-[#DAF5B7]' : 'text-mkt-ink'
                )}
              >
                {row.cost}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-3 flex items-center justify-center gap-1 text-center font-mkt-sans text-[14px] leading-6 text-mkt-muted md:text-[15.5px]">
          <Info className="size-5 shrink-0" />
          {costComparison.footnote}
        </p>
      </div>
    </MarketingSection>
  );
}
