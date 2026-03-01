'use client';

import { cn } from '@/lib/utils/cn';


interface BrandLogoProps {
  className?: string;
  showBrandLabel?: boolean;
}

export default function BrandLogo({ className, showBrandLabel = true }: BrandLogoProps) {
  return (
    <div className={cn('flex flex-col justify-center items-center gap-0', className)}>
      {/* FOR BRANDS Badge - Exact Figma specs */}
      {showBrandLabel && (
        <div 
          className="flex flex-row justify-center items-center bg-gradient-to-b from-[#E86412] to-[#F12A4C] rounded-[2px]"
          style={{ 
            width: '113px', 
            height: '12px',
            padding: '0px',
            gap: '10px'
          }}
        >
          <span 
            className="font-heading font-bold text-[11px] leading-[21px] text-white flex items-center whitespace-nowrap"
            style={{
              width: '106px',
              height: '8px',
              letterSpacing: '4px'
            }}
          >
            FOR BRANDS
          </span>
        </div>
      )}
    </div>
  );
}
