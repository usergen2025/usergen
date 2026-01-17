'use client';

import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';
import { cn } from '@/lib/utils/cn';

interface TagAwareInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyPress?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

const TAG_SUGGESTIONS = [
  // Industry
  'technology', 'healthcare', 'education', 'finance', 'retail', 'food', 
  'fashion', 'travel', 'real-estate', 'automotive', 'entertainment', 'sports',
  // Mood
  'professional', 'casual', 'energetic', 'calm', 'playful', 'serious', 
  'inspiring', 'educational', 'entertaining', 'friendly', 'trustworthy',
  // Style
  'modern', 'classic', 'minimalist', 'vibrant', 'elegant', 'bold', 
  'subtle', 'trendy', 'traditional',
  // Theme
  'product-launch', 'tutorial', 'testimonial', 'brand-story', 'how-to', 
  'explainer', 'promotional', 'announcement', 'demo', 'review',
  // Audience
  'youth', 'professionals', 'families', 'students', 'seniors', 
  'entrepreneurs', 'businesses'
];

export default function TagAwareInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  onKeyPress,
}: TagAwareInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    // Check if user is typing a tag
    const cursorPosition = e.target.selectionStart || 0;
    const textBeforeCursor = newValue.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      
      // If no space after @, show suggestions
      if (spaceIndex === -1 || spaceIndex > 0) {
        const currentTagInput = textAfterAt.split(/\s/)[0].toLowerCase();
        
        // Filter suggestions
        const filtered = TAG_SUGGESTIONS.filter(
          tag => tag.toLowerCase().startsWith(currentTagInput)
        ).slice(0, 8);
        
        setSuggestions(filtered);
        setShowSuggestions(filtered.length > 0);
        setSuggestionIndex(0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // If Enter is pressed with suggestions open, insert tag instead of submitting
        e.preventDefault();
        insertTag(suggestions[suggestionIndex]);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        insertTag(suggestions[suggestionIndex]);
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    } else {
      // Call original onKeyPress if no suggestions
      if (onKeyPress) {
        onKeyPress(e);
      }
    }
  };

  const insertTag = (tag: string) => {
    if (!inputRef.current) return;
    
    const input = inputRef.current;
    const cursorPosition = input.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPosition);
    const textAfterCursor = value.substring(cursorPosition);
    
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      
      if (spaceIndex === -1 || spaceIndex > 0) {
        // Replace @input with @tag
        const newValue = 
          textBeforeCursor.substring(0, lastAtIndex) + 
          `@${tag} ` + 
          textAfterCursor;
        
        onChange(newValue);
        setShowSuggestions(false);
        
        // Set cursor position after the tag
        setTimeout(() => {
          const newCursorPos = lastAtIndex + tag.length + 2; // +2 for '@' and ' '
          input.setSelectionRange(newCursorPos, newCursorPos);
          input.focus();
        }, 0);
      }
    }
  };

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSuggestions]);

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary transition-opacity",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      />
      
      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 bottom-full mb-1 w-full bg-secondary border border-border rounded-md shadow-lg max-h-48 overflow-y-auto"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => insertTag(suggestion)}
              className={cn(
                'w-full text-left px-4 py-2 hover:bg-primary/10 transition-colors',
                index === suggestionIndex && 'bg-primary/20'
              )}
            >
              <span className="text-text-primary">@{suggestion}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

