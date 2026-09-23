import { isResponsive, type Responsive } from '@/lib/content/landing';
import { cn } from '@/lib/utils/cn';

/**
 * Renders a string that the mobile frame shortens.
 *
 * Both variants are emitted and CSS hides one, rather than reading the
 * viewport in JS. A media query in JS is unavailable during server rendering,
 * so the server would have to guess a width and then correct itself on
 * hydration — which React reports as a mismatch, and which flashes the wrong
 * paragraph on the page we most want to render on the server.
 *
 * The cost is the duplicated bytes in the HTML. Assistive technology is not
 * affected: `hidden` is `display: none`, which drops the element from the
 * accessibility tree, so only the visible variant is announced. The
 * breakpoint must stay at Tailwind's `md` (768px), the width at which the
 * layout switches between the two frames.
 */
export default function ResponsiveCopy({
  value,
  className,
}: {
  value: Responsive<string>;
  className?: string;
}) {
  if (!isResponsive(value)) {
    return className ? <span className={className}>{value}</span> : <>{value}</>;
  }

  return (
    <>
      <span className={cn('md:hidden', className)}>{value.mobile}</span>
      <span className={cn('hidden md:inline', className)}>{value.base}</span>
    </>
  );
}
