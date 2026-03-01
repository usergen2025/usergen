'use client';

import { useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';
import { cn } from '@/lib/utils/cn';

interface AIChatTagAwareInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyPress?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

const MIN_HEIGHT = 24; // ~1 line
const MAX_HEIGHT = 168; // ~7 lines
const LINE_HEIGHT = 24; // approximate line height in px

export default function AIChatTagAwareInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  onKeyPress,
}: AIChatTagAwareInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get accurate scrollHeight
    textarea.style.height = 'auto';
    
    // Calculate new height clamped between min and max
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.min(Math.max(scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    
    textarea.style.height = `${newHeight}px`;
    
    // Enable scrolling if content exceeds max height
    textarea.style.overflowY = scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  };

  // Adjust height when value changes (including external changes)
  useEffect(() => {
    adjustHeight();
  }, [value]);

  // Initial height adjustment on mount
  useEffect(() => {
    adjustHeight();
  }, []);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    adjustHeight();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Call onKeyPress for Enter handling (submit on Enter without Shift)
    if (onKeyPress) {
      onKeyPress(e);
    }
  };

  return (
    <div className="relative flex-1 flex items-center min-h-[clamp(2rem,4vh,40px)]">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={cn(
          "w-full bg-transparent outline-none resize-none",
          "font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1.125rem,1.76vh,18px)]",
          "text-[#616161] caret-[#E86412] placeholder:text-[#9E9E9E]",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        style={{
          minHeight: `${MIN_HEIGHT}px`,
          maxHeight: `${MAX_HEIGHT}px`,
        }}
      />
    </div>
  );
}
