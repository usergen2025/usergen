'use client';

import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface TagInputProps {
  value: string;
  onChange: (value: string) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  error?: string;
}

// Tag suggestions organized by category
const TAG_SUGGESTIONS = {
  industry: ['technology', 'healthcare', 'education', 'finance', 'retail', 'food', 'fashion', 'travel', 'real-estate', 'automotive', 'entertainment', 'sports'],
  mood: ['professional', 'casual', 'energetic', 'calm', 'playful', 'serious', 'inspiring', 'educational', 'entertaining', 'friendly', 'trustworthy'],
  theme: ['product-launch', 'tutorial', 'testimonial', 'brand-story', 'how-to', 'explainer', 'promotional', 'announcement', 'demo', 'review'],
  audience: ['youth', 'professionals', 'families', 'students', 'seniors', 'entrepreneurs', 'businesses'],
  style: ['modern', 'classic', 'minimalist', 'vibrant', 'elegant', 'bold', 'subtle', 'trendy', 'traditional'],
};

const ALL_SUGGESTIONS = [
  ...TAG_SUGGESTIONS.industry,
  ...TAG_SUGGESTIONS.mood,
  ...TAG_SUGGESTIONS.theme,
  ...TAG_SUGGESTIONS.audience,
  ...TAG_SUGGESTIONS.style,
];

export default function TagInput({
  value,
  onChange,
  tags,
  onTagsChange,
  placeholder = "Write your script here... Use @tags to describe theme (e.g., @technology @professional)",
  disabled = false,
  className,
  error,
}: TagInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [tagInput, setTagInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Extract tags from input value
  useEffect(() => {
    const tagRegex = /@(\w+)/g;
    const matches = Array.from(value.matchAll(tagRegex));
    const extractedTags = matches.map(match => match[1].toLowerCase().trim());
    
    // Update tags if they've changed
    const uniqueTags = Array.from(new Set(extractedTags));
    if (JSON.stringify(uniqueTags.sort()) !== JSON.stringify(tags.sort())) {
      onTagsChange(uniqueTags);
    }
  }, [value, tags, onTagsChange]);

  // Handle input change
  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    // Check if user is typing a tag
    const cursorPosition = e.target.selectionStart;
    const textBeforeCursor = newValue.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      const newlineIndex = textAfterAt.indexOf('\n');
      
      // If no space or newline after @, show suggestions
      if ((spaceIndex === -1 || spaceIndex > 0) && (newlineIndex === -1 || newlineIndex > 0)) {
        const currentTagInput = textAfterAt.split(/\s|\n/)[0].toLowerCase();
        setTagInput(currentTagInput);
        
        // Filter suggestions
        const filtered = ALL_SUGGESTIONS.filter(
          tag => tag.toLowerCase().startsWith(currentTagInput) && !tags.includes(tag.toLowerCase())
        );
        setSuggestions(filtered.slice(0, 8)); // Show max 8 suggestions
        setShowSuggestions(filtered.length > 0);
        setSuggestionIndex(0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  // Handle key press
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertTag(suggestions[suggestionIndex]);
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Allow Enter to submit if not in tag mode
      // This will be handled by parent component
    }
  };

  // Insert tag at cursor position
  const insertTag = (tag: string) => {
    if (!textareaRef.current) return;
    
    const textarea = textareaRef.current;
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPosition);
    const textAfterCursor = value.substring(cursorPosition);
    
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      const newlineIndex = textAfterAt.indexOf('\n');
      
      if ((spaceIndex === -1 || spaceIndex > 0) && (newlineIndex === -1 || newlineIndex > 0)) {
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
          textarea.setSelectionRange(newCursorPos, newCursorPos);
          textarea.focus();
        }, 0);
      }
    }
  };

  // Remove tag
  const removeTag = (tagToRemove: string) => {
    const newValue = value.replace(new RegExp(`@${tagToRemove}\\s*`, 'gi'), '');
    onChange(newValue);
  };

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
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
    <div className={cn('w-full relative', className)}>
      {/* Tags display */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((tag) => (
            <div
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-md text-sm"
            >
              <span>@{tag}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="hover:bg-primary/20 rounded p-0.5 transition-colors"
                  aria-label={`Remove tag ${tag}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Textarea */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={6}
          className={cn(
            'w-full px-4 py-2 border border-border rounded-md',
            'bg-secondary text-text-primary',
            'placeholder:text-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'resize-none',
            error && 'border-red-500 focus:ring-red-500',
            className
          )}
        />

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-50 mt-1 w-full max-w-md bg-secondary border border-border rounded-md shadow-lg max-h-48 overflow-y-auto"
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

      {error && (
        <p className="mt-1 text-sm text-red-500">{error}</p>
      )}

      {/* Helper text */}
      <p className="mt-1 text-xs text-text-muted">
        Tip: Type @ followed by a keyword to add tags. Tags help guide the visual style of your video.
      </p>
    </div>
  );
}


