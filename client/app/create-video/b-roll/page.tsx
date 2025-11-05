'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Search, Image as ImageIcon, Video, Sparkles, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { BRollSource } from '@/types';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';

function BRollPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const projectId = searchParams.get('projectId');
  
  const [selectedSource, setSelectedSource] = useState<BRollSource | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const categories = ['all', 'technology', 'nature', 'people'];
  const mediaItems = Array.from({ length: 8 }, (_, i) => ({
    id: `item-${i}`,
    type: i % 2 === 0 ? 'image' : 'video',
  }));

  const handleNext = async () => {
    if (!projectId) {
      showToast('Project ID missing. Please try again.', 'error');
      return;
    }

    try {
      // Map frontend bRollSource to backend enum
      const bRollSourceMap: Record<BRollSource, string> = {
        'ai-generated': 'AI_GENERATED',
        'upload': 'UPLOAD',
        'stock': 'STOCK',
        'skip': 'SKIP',
      };

      // Update project step to RENDERING and save B-roll selection
      await apiClient.updateVideoProject(projectId, {
        bRollSource: selectedSource ? bRollSourceMap[selectedSource] : undefined,
        bRollVideos: selectedItems.length > 0 ? selectedItems : [],
        currentStep: 'RENDERING',
      });

      // Navigate to rendering page
      router.push(`/create-video/rendering?projectId=${projectId}`);
    } catch (error: any) {
      console.error('Failed to save B-roll selection:', error);
      showToast(error.response?.data?.message || error.message || 'Failed to save progress', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={() => router.back()}
            className="mb-6 flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back</span>
          </button>

          <h1 className={cn(typography.heading.h2, "mb-6")}>Add B-Roll</h1>

          {/* Source Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card
              selected={selectedSource === 'ai-generated'}
              onClick={() => setSelectedSource('ai-generated')}
              className="p-6 cursor-pointer text-center"
            >
              <Sparkles className="w-12 h-12 mx-auto mb-2" />
              <p className="font-medium">AI Generated</p>
            </Card>
            <Card
              selected={selectedSource === 'upload'}
              onClick={() => setSelectedSource('upload')}
              className="p-6 cursor-pointer text-center"
            >
              <Upload className="w-12 h-12 mx-auto mb-2" />
              <p className="font-medium">Upload from Device</p>
            </Card>
            <Card
              selected={selectedSource === 'stock'}
              onClick={() => setSelectedSource('stock')}
              className="p-6 cursor-pointer text-center"
            >
              <ImageIcon className="w-12 h-12 mx-auto mb-2" />
              <p className="font-medium">Select from Stock</p>
            </Card>
          </div>

          {selectedSource && (
            <>
              {/* Search and Filters */}
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                  <input
                    type="text"
                    placeholder="Search"
                    className="w-full pl-10 pr-4 py-2 border border-border rounded-full bg-secondary focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {categories.map((category) => (
                    <button
                      key={category}
                      onClick={() => setSelectedCategory(category)}
                      className={cn(
                        'px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize',
                        selectedCategory === category
                          ? 'bg-primary text-secondary'
                          : 'bg-secondary border border-border text-text-primary'
                      )}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              {/* Media Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {mediaItems.map((item) => (
                  <Card
                    key={item.id}
                    selected={selectedItems.includes(item.id)}
                    onClick={() => {
                      setSelectedItems(prev =>
                        prev.includes(item.id)
                          ? prev.filter(id => id !== item.id)
                          : [...prev, item.id]
                      );
                    }}
                    className="p-4 cursor-pointer aspect-square relative"
                  >
                    {selectedItems.includes(item.id) && (
                      <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                        <span className="text-secondary text-sm">✓</span>
                      </div>
                    )}
                    {item.type === 'image' ? (
                      <ImageIcon className="w-full h-full text-text-muted" />
                    ) : (
                      <Video className="w-full h-full text-text-muted" />
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <ProgressBar
        progress={selectedSource && selectedItems.length > 0 ? 80 : 60}
        message={selectedSource && selectedItems.length > 0 ? "Scene is set, now for final touches!" : "Yay you got a voice now!"}
        onNext={handleNext}
      />
    </div>
  );
}

export default function BRollPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <BRollPageContent />
    </Suspense>
  );
}

