'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';

export interface BRollSelection {
  type: 'stock-image' | 'stock-video' | 'upload-image' | 'upload-video';
  source: 'freepik' | 'upload';
  id?: string;
  url: string;
  downloadUrl?: string;
  file?: File;
  aspectRatio?: string;
  title?: string;
}

interface StockSearchResult {
  id: string;
  type: 'image' | 'video';
  source: 'freepik';
  title: string;
  thumbnailUrl: string;
  previewUrl: string;
  aspectRatio: string;
  premium: boolean;
  duration?: string;
  quality?: string;
}

/** Optional filters for stock **video** search (forwarded to /api/stock/search → media service). */
export interface StockVideoSearchDurationParams {
  minDuration?: number;
  maxDuration?: number;
  targetDuration?: number;
}

interface BRollSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: BRollSelection) => void;
  sceneNumber: number;
  defaultSearchTerm?: string;
  allowedTabs?: ('images' | 'videos' | 'upload')[];
  targetAspectRatio?: '9:16' | '16:9' | '9:8';
  /** When searching stock videos, narrow by duration (seconds). Ignored for image tab. */
  stockVideoDurationParams?: StockVideoSearchDurationParams;
}

type TabType = 'images' | 'videos' | 'upload';

export default function BRollSelectionModal({
  isOpen,
  onClose,
  onSelect,
  sceneNumber,
  defaultSearchTerm = '',
  allowedTabs = ['images', 'videos', 'upload'],
  targetAspectRatio = '9:16',
  stockVideoDurationParams,
}: BRollSelectionModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>(allowedTabs[0] || 'images');
  const [searchTerm, setSearchTerm] = useState(defaultSearchTerm);
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StockSearchResult | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasInitialSearched, setHasInitialSearched] = useState(false);
  const initialSearchDoneForTabRef = useRef<Record<string, boolean>>({ images: false, videos: false });

  const handleSearch = useCallback(
    async (page = 1, termOverride?: string, tabOverride?: TabType) => {
      const term = termOverride ?? searchTerm;
      if (!term.trim()) return;

    setIsSearching(true);
    setError(null);
    const tab = tabOverride ?? activeTab;
    
    try {
      const mediaType = tab === 'images' ? 'image' : 'video';
      const apiAspectRatio = targetAspectRatio === '9:8' ? '16:9' : targetAspectRatio;

      const durationQs: string[] = [];
      if (mediaType === 'video' && stockVideoDurationParams) {
        const { minDuration, maxDuration, targetDuration } = stockVideoDurationParams;
        if (minDuration != null) durationQs.push(`minDuration=${encodeURIComponent(String(minDuration))}`);
        if (maxDuration != null) durationQs.push(`maxDuration=${encodeURIComponent(String(maxDuration))}`);
        if (targetDuration != null) durationQs.push(`targetDuration=${encodeURIComponent(String(targetDuration))}`);
      }
      const durationPart = durationQs.length ? `&${durationQs.join('&')}` : '';

      const response = await fetch(
        `/api/stock/search?term=${encodeURIComponent(term)}&type=${mediaType}&page=${page}&limit=20&aspectRatio=${apiAspectRatio}${durationPart}`,
      );
      
      if (!response.ok) {
        throw new Error('Failed to search stock media');
      }
      
      const data = await response.json();
      
      if (data.success && data.data) {
        setSearchResults(data.data.results);
        setCurrentPage(data.data.pagination.page);
        setTotalPages(data.data.pagination.totalPages);
      } else {
        setSearchResults([]);
      }
    } catch (err: any) {
      setError(err.message || 'Search failed');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
      }
    },
    [searchTerm, activeTab, targetAspectRatio, stockVideoDurationParams],
  );

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSelectedItem(null);
    setSearchResults([]);
    setCurrentPage(1);
    setTotalPages(1);
    // When switching to images or videos tab, run initial search with default term if not done for this tab yet
    if ((tab === 'images' || tab === 'videos') && defaultSearchTerm.trim() && !initialSearchDoneForTabRef.current[tab]) {
      initialSearchDoneForTabRef.current[tab] = true;
      handleSearch(1, defaultSearchTerm, tab);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      setError('Please upload an image (JPG, PNG) or video (MP4, MOV) file');
      return;
    }

    setUploadedFile(file);
    setError(null);
    
    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      const videoUrl = URL.createObjectURL(file);
      setUploadPreview(videoUrl);
    }
  };

  const handleSelectStock = (item: StockSearchResult) => {
    setSelectedItem(item);
  };

  const handleConfirmSelection = () => {
    if (activeTab === 'upload' && uploadedFile) {
      const isVideo = uploadedFile.type.startsWith('video/');
      onSelect({
        type: isVideo ? 'upload-video' : 'upload-image',
        source: 'upload',
        url: uploadPreview || '',
        file: uploadedFile,
      });
    } else if (selectedItem) {
      onSelect({
        type: selectedItem.type === 'image' ? 'stock-image' : 'stock-video',
        source: 'freepik',
        id: selectedItem.id,
        url: selectedItem.previewUrl,
        title: selectedItem.title,
        aspectRatio: selectedItem.aspectRatio,
      });
    }
    onClose();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      
      if (isImage || isVideo) {
        setUploadedFile(file);
        setError(null);
        
        if (isImage) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            setUploadPreview(evt.target?.result as string);
          };
          reader.readAsDataURL(file);
        } else {
          const videoUrl = URL.createObjectURL(file);
          setUploadPreview(videoUrl);
        }
      } else {
        setError('Please upload an image or video file');
      }
    }
  };

  // Run an initial search when the modal opens and we have a default term
  useEffect(() => {
    if (!isOpen) {
      setHasInitialSearched(false);
      initialSearchDoneForTabRef.current = { images: false, videos: false };
      return;
    }

    if (!hasInitialSearched && defaultSearchTerm.trim()) {
      setHasInitialSearched(true);
      setSearchTerm(defaultSearchTerm);
      const tab = activeTab;
      initialSearchDoneForTabRef.current[tab] = true;
      handleSearch(1, defaultSearchTerm, tab);
    }
  }, [isOpen, defaultSearchTerm, hasInitialSearched, activeTab, handleSearch]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-[20px] w-[calc(100vw-2rem)] max-w-[640px] max-h-[80dvh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-heading font-semibold text-[#212121]">
            Select B-Roll for Scene {sceneNumber}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs - gradient pill style (matching voice/avatar selection) */}
        <div className="px-6 pt-3 pb-2">
          <div
            className="relative rounded-[28px]"
            style={{
              background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)',
              padding: '2px',
            }}
          >
            <div className="flex flex-row justify-center items-center gap-[4px] bg-white rounded-[26px] p-[4px]">
              {allowedTabs.includes('images') && (
                <button
                  onClick={() => handleTabChange('images')}
                  className={`flex flex-row justify-center items-center gap-2 px-4 py-2 rounded-[24px] flex-1 h-9 transition-all duration-300 ${
                    activeTab === 'images'
                      ? 'bg-gradient-to-r from-[#E86412] to-[#F12A4C]'
                      : 'bg-transparent hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`font-heading text-[0.875rem] leading-4 ${
                      activeTab === 'images' ? 'font-medium text-white' : 'font-normal text-[#212121]'
                    }`}
                  >
                    Stock Images
                  </span>
                </button>
              )}
              {allowedTabs.includes('videos') && (
                <button
                  onClick={() => handleTabChange('videos')}
                  className={`flex flex-row justify-center items-center gap-2 px-4 py-2 rounded-[24px] flex-1 h-9 transition-all duration-300 ${
                    activeTab === 'videos'
                      ? 'bg-gradient-to-r from-[#E86412] to-[#F12A4C]'
                      : 'bg-transparent hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`font-heading text-[0.875rem] leading-4 ${
                      activeTab === 'videos' ? 'font-medium text-white' : 'font-normal text-[#212121]'
                    }`}
                  >
                    Stock Videos
                  </span>
                </button>
              )}
              {allowedTabs.includes('upload') && (
                <button
                  onClick={() => handleTabChange('upload')}
                  className={`flex flex-row justify-center items-center gap-2 px-4 py-2 rounded-[24px] flex-1 h-9 transition-all duration-300 ${
                    activeTab === 'upload'
                      ? 'bg-gradient-to-r from-[#E86412] to-[#F12A4C]'
                      : 'bg-transparent hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`font-heading text-[0.875rem] leading-4 ${
                      activeTab === 'upload' ? 'font-medium text-white' : 'font-normal text-[#212121]'
                    }`}
                  >
                    Upload
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content - fixed min height so modal height is consistent across tabs (no content, with results, upload) */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 pt-2 min-h-[360px]">
          {activeTab !== 'upload' ? (
            <>
              {/* Search Bar */}
              <div className="mb-4">
                <div className="relative flex items-center bg-white rounded-full px-1 py-1 pl-3 shadow-[0px_1px_7px_rgba(87,73,119,0.12)] border border-[#F3E5DC]">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSearch();
                      } else if (e.key === 'Escape' && defaultSearchTerm.trim()) {
                        e.preventDefault();
                        setSearchTerm(defaultSearchTerm);
                        handleSearch(1, defaultSearchTerm);
                      }
                    }}
                    placeholder={defaultSearchTerm ? `Search or press Esc to reset to "${defaultSearchTerm}"` : "Search stock media..."}
                    className="flex-1 bg-transparent outline-none border-none font-heading text-[0.875rem] leading-5 text-[#616161] placeholder:text-[#9E9E9E] caret-[#E86412]"
                  />
                  {/* Clear/Reset button - shows when searchTerm differs from default */}
                  {searchTerm && searchTerm !== defaultSearchTerm && defaultSearchTerm.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm(defaultSearchTerm);
                        handleSearch(1, defaultSearchTerm);
                      }}
                      aria-label="Reset to default search"
                      className="mr-2 text-xs text-[#E86412] hover:underline"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSearch()}
                    disabled={isSearching || !searchTerm.trim()}
                    aria-label="Search stock media"
                    className="ml-1 w-6 h-6 rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <line x1="16.65" y1="16.65" x2="21" y2="21" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {/* Results area - fixed min height so layout is consistent */}
              <div className="min-h-[280px] flex flex-col">
                {searchResults.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {searchResults.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleSelectStock(item)}
                        className={`relative aspect-[9/16] rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                          selectedItem?.id === item.id
                            ? 'border-[#E86412] ring-2 ring-[#E86412]/30'
                            : 'border-transparent hover:border-gray-300'
                        }`}
                      >
                        <Image
                          src={item.thumbnailUrl}
                          alt={item.title}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                        {item.type === 'video' && item.duration && (
                          <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 text-white text-xs rounded">
                            {item.duration}
                          </div>
                        )}
                        {item.premium && (
                          <div className="absolute top-2 left-2 px-2.5 py-1 bg-yellow-500 text-white text-xs rounded-full font-medium">
                            Premium
                          </div>
                        )}
                        {selectedItem?.id === item.id && (
                          <div className="absolute top-2 right-2 w-6 h-6 bg-[#E86412] rounded-full flex items-center justify-center">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : isSearching ? (
                  <div className="flex-1 flex items-center justify-center py-12">
                    <span className="text-gray-500 text-sm">Searching...</span>
                  </div>
                ) : searchTerm ? (
                  <div className="flex-1 flex items-center justify-center py-12 text-center text-gray-500">
                    No results found. Try a different search term.
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center py-12 text-center text-gray-500 px-4">
                    Search for stock media above, or use the suggested term from your script to see results.
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  <button
                    onClick={() => handleSearch(currentPage - 1)}
                    disabled={currentPage <= 1 || isSearching}
                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1 text-gray-600">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => handleSearch(currentPage + 1)}
                    disabled={currentPage >= totalPages || isSearching}
                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          ) : (
            /* Upload Tab - same content height as images/videos tab */
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="flex flex-col items-center justify-center min-h-[360px] border-2 border-dashed border-gray-300 rounded-xl hover:border-[#E86412] transition-colors"
            >
              {uploadPreview ? (
                <div className="relative w-48 aspect-[9/16] rounded-lg overflow-hidden">
                  {uploadedFile?.type.startsWith('video/') ? (
                    <video
                      src={uploadPreview}
                      className="w-full h-full object-cover"
                      controls
                    />
                  ) : (
                    <Image
                      src={uploadPreview}
                      alt="Upload preview"
                      fill
                      className="object-cover"
                    />
                  )}
                  <button
                    onClick={() => {
                      setUploadedFile(null);
                      setUploadPreview(null);
                    }}
                    className="absolute top-2 right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center cursor-pointer p-8"
                  >
                    <div className="w-16 h-16 bg-[#E86412]/10 rounded-full flex items-center justify-center mb-4">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#E86412" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </div>
                    <p className="text-gray-700 font-medium mb-2">
                      Drop files here or click to upload
                    </p>
                    <p className="text-gray-500 text-sm">
                      Recommended: {targetAspectRatio} aspect ratio (1080x1920)
                    </p>
                    <p className="text-gray-400 text-sm mt-1">
                      Supported: JPG, PNG, MP4, MOV
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,video/mp4,video/quicktime"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </>
              )}
              {error && (
                <p className="text-red-500 text-sm mt-4">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-gray-200 rounded-full min-w-[100px] font-heading text-sm text-[#212121] hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmSelection}
            disabled={activeTab !== 'upload' ? !selectedItem : !uploadedFile}
            className="flex flex-row justify-center items-center px-4 py-1.5 bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-full min-w-[100px] font-heading font-semibold text-sm text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Select</span>
          </button>
        </div>
      </div>
    </div>
  );
}
