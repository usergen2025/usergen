'use client';

import { useState, useEffect } from 'react';
import { 
  DollarSign, 
  Save,
  History,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Image,
  Video,
  Mic,
  Play,
  Wand2
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import { useAuth } from '@/hooks/useAuth';

interface PricingItem {
  id: string;
  operationType: string;
  displayName: string;
  description: string;
  creditCost: number;
  isActive: boolean;
  updatedAt: string;
  updatedBy?: string;
}

interface PricingHistoryItem {
  id: string;
  previousCost: number;
  newCost: number;
  changedBy: string;
  reason?: string;
  createdAt: string;
}

const operationIcons: Record<string, React.ReactNode> = {
  'SCRIPT_GENERATION': <Wand2 className="w-5 h-5" />,
  'SCENE_REGENERATION': <RefreshCw className="w-5 h-5" />,
  'AUDIO_GENERATION': <Mic className="w-5 h-5" />,
  'IMAGE_GENERATION': <Image className="w-5 h-5" />,
  'VIDEO_GENERATION': <Video className="w-5 h-5" />,
  'AVATAR_VIDEO': <Play className="w-5 h-5" />,
  'STOCK_FOOTAGE': <Video className="w-5 h-5" />,
  'FINAL_RENDER': <Play className="w-5 h-5" />,
  'WATERMARK_REMOVAL': <CheckCircle className="w-5 h-5" />,
};

export default function AdminPricingPage() {
  const { user } = useAuth();
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, number>>({});
  const [editReasons, setEditReasons] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<PricingHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchPricing = async () => {
      setIsLoading(true);
      try {
        const response = await apiClient.getPricingConfig();
        if (response.success && response.data) {
          setPricing(response.data);
          // Initialize edit values
          const values: Record<string, number> = {};
          response.data.forEach((item: PricingItem) => {
            values[item.operationType] = item.creditCost;
          });
          setEditValues(values);
        }
      } catch (error) {
        console.error('Failed to fetch pricing:', error);
        // Use default mock data if API fails
        const mockPricing: PricingItem[] = [
          { id: '1', operationType: 'SCRIPT_GENERATION', displayName: 'Script Generation', description: 'AI-powered script generation', creditCost: 10, isActive: true, updatedAt: new Date().toISOString() },
          { id: '2', operationType: 'SCENE_REGENERATION', displayName: 'Scene Regeneration', description: 'Regenerate a single scene', creditCost: 5, isActive: true, updatedAt: new Date().toISOString() },
          { id: '3', operationType: 'AUDIO_GENERATION', displayName: 'Audio Generation', description: 'Text-to-speech per scene', creditCost: 5, isActive: true, updatedAt: new Date().toISOString() },
          { id: '4', operationType: 'IMAGE_GENERATION', displayName: 'Image Generation', description: 'AI B-roll image generation', creditCost: 10, isActive: true, updatedAt: new Date().toISOString() },
          { id: '5', operationType: 'VIDEO_GENERATION', displayName: 'Video Generation', description: 'Image-to-video conversion', creditCost: 20, isActive: true, updatedAt: new Date().toISOString() },
          { id: '6', operationType: 'AVATAR_VIDEO', displayName: 'Avatar Video', description: 'AI avatar video generation', creditCost: 25, isActive: true, updatedAt: new Date().toISOString() },
          { id: '7', operationType: 'STOCK_FOOTAGE', displayName: 'Stock Footage', description: 'Stock video download', creditCost: 5, isActive: true, updatedAt: new Date().toISOString() },
          { id: '8', operationType: 'FINAL_RENDER', displayName: 'Final Render', description: 'Final video rendering', creditCost: 15, isActive: true, updatedAt: new Date().toISOString() },
          { id: '9', operationType: 'WATERMARK_REMOVAL', displayName: 'Watermark Removal', description: 'Remove watermark', creditCost: 100, isActive: true, updatedAt: new Date().toISOString() },
        ];
        setPricing(mockPricing);
        const values: Record<string, number> = {};
        mockPricing.forEach((item) => {
          values[item.operationType] = item.creditCost;
        });
        setEditValues(values);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPricing();
  }, []);

  const handleSave = async (operationType: string) => {
    const newCost = editValues[operationType];
    const item = pricing.find(p => p.operationType === operationType);
    
    if (!item || newCost === item.creditCost) return;

    setIsSaving(operationType);
    try {
      const response = await apiClient.updatePricing(
        operationType, 
        newCost, 
        user?.id || '', 
        editReasons[operationType] || undefined
      );
      
      if (response.success) {
        setPricing(prev => prev.map(p => 
          p.operationType === operationType 
            ? { ...p, creditCost: newCost, updatedAt: new Date().toISOString() }
            : p
        ));
        
        setSuccessMessage(`${item.displayName} pricing updated to ₹${newCost}`);
        setTimeout(() => setSuccessMessage(null), 3000);
        setEditReasons(prev => ({ ...prev, [operationType]: '' }));
      }
    } catch (error: any) {
      console.error('Failed to update pricing:', error);
      setSuccessMessage(null);
    } finally {
      setIsSaving(null);
    }
  };

  const fetchHistory = async (operationType: string) => {
    setLoadingHistory(true);
    setShowHistory(operationType);
    try {
      const response = await apiClient.getPricingHistory(operationType, 20);
      if (response.success && response.data) {
        setHistory(response.data.map((h: any) => ({
          id: h.id,
          previousCost: h.previousCost,
          newCost: h.newCost,
          changedBy: h.changedBy || 'Admin',
          reason: h.reason,
          createdAt: h.createdAt,
        })));
      } else {
        setHistory([]);
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">Pricing Configuration</h1>
        <p className="text-gray-400">Manage credit costs for all operations</p>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="mb-6 p-4 bg-green-500/20 border border-green-500/50 rounded-lg flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <span className="text-green-400">{successMessage}</span>
        </div>
      )}

      {/* Info Banner */}
      <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-blue-300 font-medium">Pricing Changes</p>
          <p className="text-blue-400/80 text-sm">
            Changes to pricing will only affect new generations. Existing billing records preserve historical pricing.
          </p>
        </div>
      </div>

      {/* Pricing Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pricing.map((item) => {
          const hasChanged = editValues[item.operationType] !== item.creditCost;
          const isSavingThis = isSaving === item.operationType;

          return (
            <div
              key={item.id}
              className={cn(
                "bg-gray-800 rounded-xl border p-4 transition-colors",
                hasChanged ? "border-orange-500" : "border-gray-700"
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500/20 to-pink-500/20 flex items-center justify-center text-orange-400">
                    {operationIcons[item.operationType] || <DollarSign className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{item.displayName}</h3>
                    <p className="text-xs text-gray-500">{item.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => fetchHistory(item.operationType)}
                  className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                  title="View history"
                >
                  <History className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Credit Cost (₹)</label>
                  <input
                    type="number"
                    value={editValues[item.operationType] ?? item.creditCost}
                    onChange={(e) => setEditValues(prev => ({
                      ...prev,
                      [item.operationType]: parseInt(e.target.value) || 0
                    }))}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                    min="0"
                  />
                </div>

                {hasChanged && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Reason for change (optional)</label>
                    <input
                      type="text"
                      value={editReasons[item.operationType] || ''}
                      onChange={(e) => setEditReasons(prev => ({
                        ...prev,
                        [item.operationType]: e.target.value
                      }))}
                      placeholder="e.g., Market adjustment"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-orange-500"
                    />
                  </div>
                )}

                {hasChanged && (
                  <button
                    onClick={() => handleSave(item.operationType)}
                    disabled={isSavingThis}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isSavingThis ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>Save Changes</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-white font-semibold">Pricing History</h3>
              <button
                onClick={() => setShowHistory(null)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto">
              {loadingHistory ? (
                <div className="flex justify-center py-8">
                  <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : history.length > 0 ? (
                <div className="space-y-3">
                  {history.map((h) => (
                    <div key={h.id} className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-medium">
                          ₹{h.previousCost} → ₹{h.newCost}
                        </span>
                        <span className="text-xs text-gray-400">{formatDate(h.createdAt)}</span>
                      </div>
                      {h.reason && <p className="text-sm text-gray-400">{h.reason}</p>}
                      <p className="text-xs text-gray-500">Changed by: {h.changedBy}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-400 py-8">No history available</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
