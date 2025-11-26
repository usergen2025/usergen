'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Check, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';

interface ModelInfo {
  id: string;
  displayName: string;
  platform: string;
  defaultConfig: any;
  capabilities: any;
}

interface ModelSelectorProps {
  selectedModelId: string;
  onModelSelect: (modelId: string) => void;
  disabled?: boolean;
  getModelsFn?: () => Promise<any>; // Optional function to fetch models (for video models)
}

// Initialize with fallback models immediately so menu can work even if API fails
// These are for image models - video models will be fetched via getModelsFn
const fallbackModels: ModelInfo[] = [
  { id: 'model-1', displayName: 'Model 1', platform: 'FAL', defaultConfig: {}, capabilities: {} },
  { id: 'model-2', displayName: 'Model 2', platform: 'FAL', defaultConfig: {}, capabilities: {} },
  { id: 'model-3', displayName: 'Model 3', platform: 'FAL', defaultConfig: {}, capabilities: {} },
  { id: 'model-4', displayName: 'Model 4', platform: 'FAL', defaultConfig: {}, capabilities: {} },
  { id: 'model-5', displayName: 'Model 5', platform: 'BYTEPLUS', defaultConfig: {}, capabilities: {} },
];

// Fallback models for video (used if getModelsFn is provided but fails)
const fallbackVideoModels: ModelInfo[] = [
  { id: 'video-model-1', displayName: 'Model 1', platform: 'BYTEPLUS', defaultConfig: {}, capabilities: {} },
  { id: 'video-model-2', displayName: 'Model 2', platform: 'FAL', defaultConfig: {}, capabilities: {} },
];

export function ModelSelector({ selectedModelId, onModelSelect, disabled, getModelsFn }: ModelSelectorProps) {
  // Use video fallback models if getModelsFn is provided (indicates video models), otherwise use image fallback
  const [models, setModels] = useState<ModelInfo[]>(getModelsFn ? fallbackVideoModels : fallbackModels);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 192 }); // Default width, will be updated to container width
  
  // Use refs to store stable function references for event listeners
  const handleClickOutsideRef = useRef<(event: MouseEvent) => void>(() => {});
  
  // Track if button was just clicked to prevent immediate close
  const buttonJustClickedRef = useRef(false);

  // Helper function to find the parent container (the split button container)
  const getParentContainer = (): HTMLElement | null => {
    if (!buttonRef.current) return null;
    // Find the parent container (the flex div that contains both buttons)
    const parent = buttonRef.current.closest('.flex.items-stretch');
    return parent as HTMLElement | null;
  };

  // Helper function to calculate dropdown position with viewport overflow detection
  const calculateDropdownPosition = (element: HTMLElement): { top: number; left: number; width: number } => {
    const rect = element.getBoundingClientRect();
    
    // Estimate dropdown height
    // Header section: "Select Model" text (~32px) + border (~1px) + padding (~16px) = ~49px
    // Each model item: ~40px (py-2 = 8px top + 8px bottom + text line height ~24px)
    // Bottom padding: ~8px
    const headerHeight = 49;
    const itemHeight = 40;
    const bottomPadding = 8;
    const estimatedDropdownHeight = headerHeight + (models.length * itemHeight) + bottomPadding;
    
    // Check if dropdown would overflow below viewport
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const wouldOverflowBelow = (rect.bottom + 5 + estimatedDropdownHeight) > window.innerHeight;
    
    // Position above if it would overflow below AND there's more space above
    // Also position above if space below is less than estimated height
    const shouldPositionAbove = wouldOverflowBelow && (spaceAbove >= estimatedDropdownHeight + 5);
    
    const top = shouldPositionAbove 
      ? rect.top - estimatedDropdownHeight - 5  // 5px above button top
      : rect.bottom + 5;  // 5px below button bottom (default)
    
    console.log('[ModelSelector] Position calculation:', {
      wouldOverflowBelow,
      shouldPositionAbove,
      spaceBelow,
      spaceAbove,
      estimatedDropdownHeight,
      top,
      rectBottom: rect.bottom,
      viewportHeight: window.innerHeight,
    });
    
    return {
      top,
      left: rect.left,
      width: rect.width,
    };
  };

  useEffect(() => {
    // Fetch models from API (non-blocking - fallback models already set)
    setLoading(true);
    const fetchModels = getModelsFn || (() => apiClient.getImageGenerationModels());
    fetchModels()
      .then(response => {
        if (response.success && response.data && response.data.models) {
          setModels(response.data.models);
        } else {
          console.warn('[ModelSelector] API returned unsuccessful response:', response);
          // Keep fallback models
        }
      })
      .catch(error => {
        console.error('[ModelSelector] Failed to fetch models:', error);
        // Keep fallback models
      })
      .finally(() => setLoading(false));
  }, [getModelsFn]);

  // Calculate dropdown position when opening - use requestAnimationFrame to ensure it happens after render
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      // Use requestAnimationFrame to ensure position is calculated after DOM update
      requestAnimationFrame(() => {
        // Find parent container (split button container) or fallback to button
        const container = getParentContainer();
        const element = container || buttonRef.current;
        if (element) {
          const newPosition = calculateDropdownPosition(element);
          console.log('[ModelSelector] Position calculated:', newPosition, 'Container rect:', element.getBoundingClientRect());
          setDropdownPosition(newPosition);
        }
      });
    }
  }, [isOpen, models.length]);

  // Close dropdown when clicking outside - use click event with flag to avoid race condition
  useEffect(() => {
    // Update the ref with the current handler
    handleClickOutsideRef.current = (event: MouseEvent) => {
      // Ignore if button was just clicked (prevents race condition)
      if (buttonJustClickedRef.current) {
        buttonJustClickedRef.current = false;
        console.log('[ModelSelector] Ignoring click outside - button was just clicked');
        return;
      }

      if (
        dropdownRef.current &&
        buttonRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        console.log('[ModelSelector] Click outside detected, closing menu');
        setIsOpen(false);
      }
    };

    if (isOpen) {
      // Use click event instead of mousedown to avoid race condition
      // Add listener with capture phase to catch events early
      document.addEventListener('click', handleClickOutsideRef.current, true);
    }

    return () => {
      document.removeEventListener('click', handleClickOutsideRef.current, true);
    };
  }, [isOpen]);

  // Update position on scroll/resize when open
  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      // Find parent container (split button container) or fallback to button
      const container = getParentContainer();
      const element = container || buttonRef.current;
      if (element) {
        const newPosition = calculateDropdownPosition(element);
        setDropdownPosition(newPosition);
      }
    };

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, models.length]);

  const handleModelSelect = (modelId: string) => {
    console.log('[ModelSelector] Model selected:', modelId);
    onModelSelect(modelId);
    setIsOpen(false);
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) {
      console.log('[ModelSelector] Button click ignored - disabled');
      return;
    }

    console.log('[ModelSelector] Button clicked, current isOpen:', isOpen);

    // Set flag to prevent click-outside handler from immediately closing
    buttonJustClickedRef.current = true;
    
    // Clear flag after a brief delay to allow click event to complete
    setTimeout(() => {
      buttonJustClickedRef.current = false;
    }, 100);

    // Calculate position immediately before opening
    // Find parent container (split button container) or fallback to button
    const container = getParentContainer();
    const element = container || buttonRef.current;
    if (element) {
      const newPosition = calculateDropdownPosition(element);
      console.log('[ModelSelector] Pre-calculated position:', newPosition, 'Container rect:', element.getBoundingClientRect());
      setDropdownPosition(newPosition);
    }

    // Toggle state
    setIsOpen(prev => {
      const newState = !prev;
      console.log('[ModelSelector] State toggled:', prev, '->', newState);
      if (newState) {
        console.log('[ModelSelector] Menu opened, models count:', models.length);
      }
      return newState;
    });
  };

  return (
    <>
      {/* Icon button to open menu - styled to match button */}
      <button
        ref={buttonRef}
        onClick={handleButtonClick}
        disabled={disabled}
        className={cn(
          "px-3 py-2 border-0 border-l border-border bg-transparent hover:bg-primary-light/10 transition-colors flex items-center justify-center",
          disabled 
            ? "opacity-50 cursor-not-allowed" 
            : "cursor-pointer",
          isOpen && "bg-primary-light/20"
        )}
        aria-label="Select model"
        type="button"
      >
        <Settings className="w-4 h-4 text-text-secondary" />
      </button>

      {/* Dropdown menu - rendered via portal */}
      {isOpen && typeof window !== 'undefined' && document?.body && createPortal(
        <div
          ref={dropdownRef}
          className="fixed bg-background rounded-lg shadow-lg border border-border z-[9999]"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            console.log('[ModelSelector] Dropdown clicked');
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            console.log('[ModelSelector] Dropdown mousedown');
          }}
        >
          <div className="p-2">
            <div className="px-2 py-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Select Model
            </div>
            <div className="border-t border-border my-1" />
            {loading && models.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-secondary flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading models...
              </div>
            ) : models.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-secondary">No models available</div>
            ) : (
              models.map((model) => (
                <button
                  key={model.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleModelSelect(model.id);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded transition-colors flex items-center justify-between",
                    selectedModelId === model.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-primary-light/10 text-text-primary"
                  )}
                >
                  <span>{model.displayName}</span>
                  {selectedModelId === model.id && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

