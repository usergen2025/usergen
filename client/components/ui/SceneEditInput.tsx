'use client';

import { useRef, useEffect, useState, KeyboardEvent } from 'react';
import { cn } from '@/lib/utils/cn';

interface SceneEditInputProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
  disabled?: boolean;
  isSaving?: boolean;
  isDirty?: boolean;
}

const MIN_HEIGHT = 24;
const MAX_HEIGHT = 120;

export default function SceneEditInput({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder,
  disabled,
  isSaving,
  isDirty,
}: SceneEditInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.min(Math.max(scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  useEffect(() => {
    adjustHeight();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Save on Ctrl/Cmd + Enter
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && isDirty && !disabled && !isSaving) {
      e.preventDefault();
      onSave();
    }
    // Cancel on Escape
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div 
      className={cn(
        "rounded-[16px] w-full transition-all",
        isFocused 
          ? "p-[2px]" 
          : "p-0 shadow-[0px_2px_12px_rgba(224,140,138,0.3)]"
      )}
      style={isFocused ? {
        background: 'linear-gradient(278.75deg, rgba(254, 89, 191, 0.4) 13.19%, rgba(231, 76, 60, 0.4) 46.27%, rgba(254, 201, 89, 0.4) 74.45%, rgba(231, 57, 19, 0.4) 96.51%)'
      } : {}}
    >
      <div className={cn(
        "flex flex-row items-end gap-2 bg-white rounded-[16px] w-full",
        isFocused ? "px-3 py-2" : "px-3 py-2"
      )}>
        {/* Auto-expanding textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            adjustHeight();
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isSaving}
          rows={1}
          className={cn(
            "flex-1 bg-transparent outline-none resize-none",
            "font-heading text-[14px] text-[#212121] leading-[1.4]",
            "placeholder:text-[#9E9E9E]",
            (disabled || isSaving) && "opacity-50 cursor-not-allowed"
          )}
          style={{
            minHeight: `${MIN_HEIGHT}px`,
            maxHeight: `${MAX_HEIGHT}px`,
          }}
        />
        
        {/* Save Button (checkmark) */}
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || isSaving || !isDirty}
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
            "bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white",
            "hover:opacity-90",
            (disabled || isSaving || !isDirty) && "opacity-50 cursor-not-allowed"
          )}
          title="Save (Ctrl+Enter)"
        >
          {isSaving ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        
        {/* Cancel Button (X) */}
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled || isSaving}
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
            "bg-gray-100 hover:bg-gray-200 text-gray-600",
            (disabled || isSaving) && "opacity-50 cursor-not-allowed"
          )}
          title="Cancel (Esc)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
