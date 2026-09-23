import Image from 'next/image';
import { cn } from '@/lib/utils/cn';
import type { MediaAsset } from '@/lib/content/landing';

/**
 * An illustration or poster slot on the marketing pages.
 *
 * Roughly a third of the design's surface is imagery, all of it sized by the
 * box rather than by the file, so every usage is `fill` over a container that
 * already has its height from the layout. The container keeps a sand
 * background: it shows through while the image decodes, and on the contain
 * slots it is the matte the artwork sits on.
 *
 * `sizes` has no default on purpose. Next generates a srcset from it, and a
 * wrong value costs either a blurry image or a needlessly large download, so
 * each caller states the width its own layout gives the box.
 */
export default function MarketingMedia({
  media,
  className,
  sizes,
  fit = 'cover',
  priority = false,
  children,
}: {
  media: MediaAsset;
  className?: string;
  sizes: string;
  fit?: 'cover' | 'contain';
  priority?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('relative overflow-hidden bg-mkt-sand/60', className)}>
      <Image
        src={media.src}
        alt={media.alt}
        fill
        sizes={sizes}
        priority={priority}
        className={fit === 'cover' ? 'object-cover' : 'object-contain'}
      />
      {children ? (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      ) : null}
    </div>
  );
}
