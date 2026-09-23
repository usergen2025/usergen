import { cn } from '@/lib/utils/cn';

/**
 * Stands in for the design's illustration and video areas.
 *
 * Roughly a third of the marketing design's surface is imagery that the Figma
 * file leaves as empty `url(.png)` fills — the avatar collages, the reel
 * posters, the translation player and the closing panel's two stills. There
 * is nothing to export, so these boxes reproduce the shape, radius and
 * background the design specifies and stay visibly unfinished rather than
 * being faked with stock imagery.
 *
 * TODO(assets): replace each usage with `next/image` once the real artwork
 * exists. Every instance is a leaf element, so no layout changes with it.
 */
export default function PlaceholderMedia({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-mkt-sand/60',
        className
      )}
    >
      {/* A faint diagonal hatch, so an empty box does not read as a broken image. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg, var(--color-mkt-line-warm) 0 2px, transparent 2px 10px)',
        }}
      />
      {children}
    </div>
  );
}
