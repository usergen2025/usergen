'use client';

import { useState, useRef, useEffect, KeyboardEvent, FormEvent } from 'react';
import { cn } from '@/lib/utils/cn';

interface AIChatTagAwareInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyPress?: (e: KeyboardEvent<HTMLDivElement>) => void;
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

export default function AIChatTagAwareInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  onKeyPress,
}: AIChatTagAwareInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const editableRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert plain text to HTML with tag highlighting
  // Only formats tags that are "confirmed" (followed by space or at end of text after selection)
  const formatTextWithTags = (text: string, cursorPosition?: number): string => {
    if (!text) return '';
    
    const parts: Array<{ type: 'text' | 'tag'; content: string }> = [];
    const tagRegex = /@(\w+)/g;
    let lastIndex = 0;
    let match;
    
    while ((match = tagRegex.exec(text)) !== null) {
      const tagStart = match.index;
      const tagEnd = match.index + match[0].length;
      const tagName = match[1];
      
      // Add text before tag
      if (tagStart > lastIndex) {
        const textBefore = text.substring(lastIndex, tagStart);
        const escaped = textBefore
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        parts.push({ type: 'text', content: escaped });
      }
      
      // Check if this tag is "confirmed" (followed by space)
      // Also check if cursor is currently at or inside this tag (if so, don't format it yet)
      const textAfterTag = text.substring(tagEnd);
      const isFollowedBySpace = textAfterTag.length > 0 && textAfterTag[0] === ' ';
      // Cursor is "at or in tag" if it's between @ (inclusive) and the end of tag (inclusive)
      // This means user is actively typing or just finished typing the tag
      const isCursorAtOrInTag = cursorPosition !== undefined && 
        cursorPosition >= tagStart && cursorPosition <= tagEnd;
      
      // Only format as capsule if:
      // 1. Tag is followed by space (confirmed) AND cursor is not at/in the tag
      // This ensures tags are only formatted when they're complete and user has moved on
      if (isFollowedBySpace && !isCursorAtOrInTag) {
        // Format as confirmed tag (capsule)
        parts.push({ type: 'tag', content: tagName });
      } else {
        // Keep as plain text (user is still typing)
        const escaped = `@${tagName}`
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        parts.push({ type: 'text', content: escaped });
      }
      
      lastIndex = tagEnd;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      const textAfter = text.substring(lastIndex);
      const escaped = textAfter
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      parts.push({ type: 'text', content: escaped });
    }
    
    // Build HTML
    return parts.map(part => {
      if (part.type === 'tag') {
        return `<span class="inline-flex items-center px-[clamp(0.375rem,0.75vh,8px)] py-[clamp(0.125rem,0.25vh,3px)] bg-gradient-to-r from-[#E86412]/20 to-[#F12A4C]/20 border border-[#E86412]/30 rounded-full text-[#E86412] font-medium">${part.content}</span>`;
      }
      return part.content;
    }).join('');
  };

  // Extract plain text from contentEditable
  const getPlainText = (): string => {
    if (!editableRef.current) return '';
    return editableRef.current.innerText || '';
  };

  // Update the contentEditable with formatted HTML
  const updateContent = (plainText: string, preserveCursor: boolean = false) => {
    if (!editableRef.current) return;
    
    let cursorPos: number | undefined = undefined;
    if (preserveCursor) {
      cursorPos = getCursorPosition();
    }
    
    editableRef.current.innerHTML = formatTextWithTags(plainText, cursorPos);
    
    // Restore cursor position if needed
    if (preserveCursor && cursorPos !== undefined && cursorPos > 0) {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection) return;
        
        try {
          // Find the text node and set cursor
          const walker = document.createTreeWalker(
            editableRef.current!,
            NodeFilter.SHOW_TEXT,
            null
          );
          
          let currentPos = 0;
          let textNode: Node | null = null;
          
          while ((textNode = walker.nextNode())) {
            const nodeLength = textNode.textContent?.length || 0;
            if (currentPos + nodeLength >= cursorPos) {
              const range = document.createRange();
              const offset = cursorPos - currentPos;
              range.setStart(textNode, offset);
              range.setEnd(textNode, offset);
              selection.removeAllRanges();
              selection.addRange(range);
              return;
            }
            currentPos += nodeLength;
          }
          
          // If we couldn't find the position, set to end
          const range = document.createRange();
          range.selectNodeContents(editableRef.current);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (e) {
          // Fallback: set cursor to end
          const range = document.createRange();
          range.selectNodeContents(editableRef.current!);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }, 0);
    }
  };

  const handleInput = (e: FormEvent<HTMLDivElement>) => {
    // Get cursor position BEFORE any updates
    const cursorPosition = getCursorPosition();
    const plainText = getPlainText();
    onChange(plainText);
    
    // Check if user is typing a tag (before formatting)
    const textBeforeCursor = plainText.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      
      // Check if there's a space immediately after @
      if (textAfterAt.length === 0 || textAfterAt[0] === ' ') {
        setShowSuggestions(false);
      } else {
        const spaceIndex = textAfterAt.indexOf(' ');
        
        if (spaceIndex === -1) {
          // No space found - we're actively typing a tag
          const currentTagInput = textAfterAt.toLowerCase();
          
          const filtered = TAG_SUGGESTIONS.filter(
            tag => tag.toLowerCase().startsWith(currentTagInput)
          ).slice(0, 8);
          
          setSuggestions(filtered);
          setShowSuggestions(filtered.length > 0);
          setSuggestionIndex(0);
        } else if (spaceIndex > 0) {
          // Space exists but not immediately after @ - still typing tag
          const currentTagInput = textAfterAt.substring(0, spaceIndex).toLowerCase();
          
          const filtered = TAG_SUGGESTIONS.filter(
            tag => tag.toLowerCase().startsWith(currentTagInput)
          ).slice(0, 8);
          
          setSuggestions(filtered);
          setShowSuggestions(filtered.length > 0);
          setSuggestionIndex(0);
        } else {
          // Space is immediately after @ - don't show suggestions
          setShowSuggestions(false);
        }
      }
    } else {
      setShowSuggestions(false);
    }
    
    // Format the content to show tags (preserve cursor)
    // Use the cursor position we captured earlier
    updateContent(plainText, true);
  };

  const getCursorPosition = (): number => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return 0;
    
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(editableRef.current!);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        insertTag(suggestions[suggestionIndex]);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        insertTag(suggestions[suggestionIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
      } else if (e.key === ' ') {
        // Space key - confirm current tag input and close suggestions
        e.preventDefault();
        const plainText = getPlainText();
        const cursorPosition = getCursorPosition();
        const textBeforeCursor = plainText.substring(0, cursorPosition);
        const textAfterCursor = plainText.substring(cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        
        if (lastAtIndex !== -1) {
          const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
          // If we're typing a tag (no space after @ yet), confirm it by adding space
          if (textAfterAt.indexOf(' ') === -1 && textAfterAt.length > 0) {
            const newText = textBeforeCursor + ' ' + textAfterCursor;
            onChange(newText);
            updateContent(newText, true);
            setShowSuggestions(false);
          } else {
            // Already has space or no tag input, just close dropdown
            setShowSuggestions(false);
          }
        } else {
          setShowSuggestions(false);
        }
      }
    } else {
      // No suggestions showing - check if user is typing a tag and wants to confirm it
      const plainText = getPlainText();
      const cursorPosition = getCursorPosition();
      const textBeforeCursor = plainText.substring(0, cursorPosition);
      const textAfterCursor = plainText.substring(cursorPosition);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');
      
      if (lastAtIndex !== -1) {
        const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
        // If we're typing a tag (no space after @ yet) and user presses Tab or Space
        if ((e.key === 'Tab' || e.key === ' ') && textAfterAt.indexOf(' ') === -1 && textAfterAt.length > 0) {
          e.preventDefault();
          // Confirm the tag by adding a space
          const newText = textBeforeCursor + ' ' + textAfterCursor;
          onChange(newText);
          updateContent(newText, true);
        }
        // For Enter, let it bubble up (submit form) - don't prevent default
      }
      
      // Call original onKeyPress if no suggestions
      if (onKeyPress) {
        onKeyPress(e);
      }
    }
  };

  const insertTag = (tag: string) => {
    if (!editableRef.current) return;
    
    const plainText = getPlainText();
    const cursorPosition = getCursorPosition();
    const textBeforeCursor = plainText.substring(0, cursorPosition);
    const textAfterCursor = plainText.substring(cursorPosition);
    
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      
      if (spaceIndex === -1 || spaceIndex > 0) {
        // Replace @input with @tag + space
        const newText = 
          textBeforeCursor.substring(0, lastAtIndex) + 
          `@${tag} ` + 
          textAfterCursor;
        
        onChange(newText);
        // Format and preserve cursor position after tag
        const newCursorPos = lastAtIndex + tag.length + 2; // +2 for '@' and ' '
        editableRef.current.innerHTML = formatTextWithTags(newText);
        
        // Set cursor after the tag
        setTimeout(() => {
          const selection = window.getSelection();
          if (!selection) return;
          
          try {
            const walker = document.createTreeWalker(
              editableRef.current!,
              NodeFilter.SHOW_TEXT,
              null
            );
            
            let currentPos = 0;
            let textNode: Node | null = null;
            
            while ((textNode = walker.nextNode())) {
              const nodeLength = textNode.textContent?.length || 0;
              if (currentPos + nodeLength >= newCursorPos) {
                const range = document.createRange();
                const offset = newCursorPos - currentPos;
                range.setStart(textNode, offset);
                range.setEnd(textNode, offset);
                selection.removeAllRanges();
                selection.addRange(range);
                editableRef.current?.focus();
                return;
              }
              currentPos += nodeLength;
            }
            
            // Fallback: set to end
            const range = document.createRange();
            range.selectNodeContents(editableRef.current!);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
            editableRef.current?.focus();
          } catch (e) {
            // Fallback: set cursor to end
            const range = document.createRange();
            range.selectNodeContents(editableRef.current!);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
            editableRef.current?.focus();
          }
        }, 0);
        
        setShowSuggestions(false);
      }
    }
  };

  // Sync value prop with contentEditable (only when value changes externally)
  useEffect(() => {
    if (!editableRef.current) return;
    const currentText = getPlainText();
    if (currentText !== value) {
      // Don't preserve cursor when value changes externally (e.g., from parent)
      editableRef.current.innerHTML = formatTextWithTags(value);
    }
  }, [value]);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        editableRef.current &&
        !editableRef.current.contains(event.target as Node) &&
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
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
    <div ref={containerRef} className="relative flex-1">
      {/* ContentEditable div for input with tag highlighting */}
      <div
        ref={editableRef}
        contentEditable={!disabled}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full bg-transparent outline-none",
          "font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)]",
          "text-[#616161] caret-[#E86412]",
          "whitespace-pre-wrap break-words",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        style={{
          minHeight: '1.5em',
        }}
        suppressContentEditableWarning
      />
      
      {/* Placeholder styling */}
      {!value && placeholder && (
        <div 
          className="absolute inset-0 pointer-events-none flex items-center text-[#9E9E9E] font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal"
          style={{ 
            paddingLeft: 'inherit',
            paddingRight: 'inherit',
          }}
        >
          {placeholder}
        </div>
      )}
      
      {/* Suggestions dropdown - New AI Chat styling */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 bottom-full mb-[5px] left-0 right-0 w-full bg-white border border-[#E0E0E0] rounded-[20px] shadow-[0px_4px_22px_rgba(102,118,108,0.12)] max-h-[clamp(200px,25vh,300px)] overflow-y-auto"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => insertTag(suggestion)}
              className={cn(
                'w-full text-left px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.98vh,10px)] transition-colors font-heading text-[clamp(0.875rem,1.56vh,16px)]',
                index === suggestionIndex 
                  ? 'bg-gradient-to-r from-[#E86412]/10 to-[#F12A4C]/10 text-[#E86412]' 
                  : 'text-[#212121] hover:bg-gradient-to-r hover:from-[#E86412]/5 hover:to-[#F12A4C]/5'
              )}
            >
              <span className="inline-flex items-center px-[clamp(0.375rem,0.75vh,8px)] py-[clamp(0.125rem,0.25vh,3px)] bg-gradient-to-r from-[#E86412]/20 to-[#F12A4C]/20 border border-[#E86412]/30 rounded-full text-[#E86412] font-medium mr-2">
                {suggestion}
              </span>
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
