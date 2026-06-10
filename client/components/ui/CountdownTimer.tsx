'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

interface CountdownTimerProps {
  targetDate: string | Date;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'compact' | 'minimal';
  showLabels?: boolean;
  showSeparators?: boolean;
  onComplete?: () => void;
}

function calculateTimeLeft(targetDate: string | Date): TimeLeft | null {
  const difference = +new Date(targetDate) - +new Date();
  if (difference > 0) {
    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((difference / 1000 / 60) % 60),
      seconds: Math.floor((difference / 1000) % 60),
    };
  }
  return null;
}

function Digit({ value, size }: { value: string; size: 'sm' | 'md' | 'lg' }) {
  const fontSizes = {
    sm: 'text-xl sm:text-2xl',
    md: 'text-2xl sm:text-3xl md:text-4xl',
    lg: 'text-3xl sm:text-4xl md:text-5xl',
  };
  const heights = {
    sm: 'h-7 sm:h-8',
    md: 'h-8 sm:h-10 md:h-12',
    lg: 'h-10 sm:h-12 md:h-14',
  };
  const widths = {
    sm: 'w-5 sm:w-6',
    md: 'w-6 sm:w-7 md:w-8',
    lg: 'w-7 sm:w-9 md:w-10',
  };

  return (
    <div
      className={`relative ${heights[size]} ${widths[size]} overflow-hidden flex justify-center`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className={`${fontSizes[size]} font-heading font-bold text-[#E86512] absolute`}
          style={{ lineHeight: 1 }}
          initial={{ y: '-60%', opacity: 0, filter: 'blur(4px)' }}
          animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '60%', opacity: 0, filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 1 }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function NumberGroup({
  value,
  label,
  size,
  showLabel,
}: {
  value: number;
  label: string;
  size: 'sm' | 'md' | 'lg';
  showLabel: boolean;
}) {
  const digits = (value < 10 ? `0${value}` : `${value}`).split('');
  const labelSizes = {
    sm: 'text-[9px] sm:text-[10px]',
    md: 'text-[10px] sm:text-xs',
    lg: 'text-xs sm:text-sm',
  };

  return (
    <div className="flex flex-col items-center">
      <div className="flex justify-center">
        {digits.map((digit, index) => (
          <Digit key={index} value={digit} size={size} />
        ))}
      </div>
      {showLabel && (
        <div
          className={`${labelSizes[size]} font-heading font-semibold text-[#9E9E9E] uppercase tracking-wider mt-1.5 sm:mt-2`}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function Separator({ size }: { size: 'sm' | 'md' | 'lg' }) {
  const fontSizes = {
    sm: 'text-xl sm:text-2xl',
    md: 'text-2xl sm:text-3xl md:text-4xl',
    lg: 'text-3xl sm:text-4xl md:text-5xl',
  };

  return (
    <div
      className={`${fontSizes[size]} font-bold text-[#E86512]/20 leading-none`}
    >
      :
    </div>
  );
}

export function CountdownTimer({
  targetDate,
  label,
  size = 'md',
  variant = 'default',
  showLabels = true,
  showSeparators = true,
  onComplete,
}: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(
    calculateTimeLeft(targetDate)
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const newTimeLeft = calculateTimeLeft(targetDate);
      setTimeLeft(newTimeLeft);
      if (!newTimeLeft && onComplete) {
        onComplete();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [targetDate, onComplete]);

  if (!timeLeft) {
    return (
      <div className="text-sm font-heading font-medium text-emerald-600">
        {label ? `${label} complete` : 'Time\'s up!'}
      </div>
    );
  }

  const gaps = {
    sm: 'gap-2 sm:gap-3',
    md: 'gap-3 sm:gap-4',
    lg: 'gap-4 sm:gap-5 md:gap-6',
  };

  if (variant === 'minimal') {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      <div className="font-heading font-semibold text-[#E86512]">
        {timeLeft.days > 0 && `${timeLeft.days}d `}
        {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`flex items-center ${gaps[size]}`}>
        {timeLeft.days > 0 && (
          <>
            <div className="flex items-baseline gap-0.5">
              <span className="font-heading font-bold text-[#E86512] text-lg">
                {timeLeft.days}
              </span>
              <span className="text-[9px] font-semibold text-[#9E9E9E] uppercase">d</span>
            </div>
            <span className="text-[#E86512]/30">:</span>
          </>
        )}
        <div className="flex items-baseline gap-0.5">
          <span className="font-heading font-bold text-[#E86512] text-lg">
            {String(timeLeft.hours).padStart(2, '0')}
          </span>
          <span className="text-[9px] font-semibold text-[#9E9E9E] uppercase">h</span>
        </div>
        <span className="text-[#E86512]/30">:</span>
        <div className="flex items-baseline gap-0.5">
          <span className="font-heading font-bold text-[#E86512] text-lg">
            {String(timeLeft.minutes).padStart(2, '0')}
          </span>
          <span className="text-[9px] font-semibold text-[#9E9E9E] uppercase">m</span>
        </div>
        <span className="text-[#E86512]/30">:</span>
        <div className="flex items-baseline gap-0.5">
          <span className="font-heading font-bold text-[#E86512] text-lg">
            {String(timeLeft.seconds).padStart(2, '0')}
          </span>
          <span className="text-[9px] font-semibold text-[#9E9E9E] uppercase">s</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {label && (
        <div className="text-xs font-heading font-medium text-[#616161] mb-2">
          {label}
        </div>
      )}
      <div className={`flex items-start ${gaps[size]}`}>
        <NumberGroup
          value={timeLeft.days}
          label="Days"
          size={size}
          showLabel={showLabels}
        />
        {showSeparators && <Separator size={size} />}
        <NumberGroup
          value={timeLeft.hours}
          label="Hours"
          size={size}
          showLabel={showLabels}
        />
        {showSeparators && <Separator size={size} />}
        <NumberGroup
          value={timeLeft.minutes}
          label="Mins"
          size={size}
          showLabel={showLabels}
        />
        {showSeparators && <Separator size={size} />}
        <NumberGroup
          value={timeLeft.seconds}
          label="Secs"
          size={size}
          showLabel={showLabels}
        />
      </div>
    </div>
  );
}

export default CountdownTimer;
