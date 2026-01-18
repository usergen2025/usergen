'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import { ArrowLeft, Calendar, IndianRupee, Info, Wallet, Paperclip } from 'lucide-react';

const DUMMY_CAMPAIGNS_KEY = 'dummy_campaigns';

export default function CreateCampaignPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    brandAssetsUrl: '',
    deadlineToApply: '',
    startDate: '',
    endDate: '',
    payoutRate: '',
    totalBudget: '',
  });

  // Dummy wallet balance - in real app, fetch from backend
  const walletBalance = 50000;
  const budgetValue = parseFloat(formData.totalBudget) || 0;
  const isBalanceSufficient = budgetValue <= walletBalance && budgetValue > 0;

  // Validation helper
  const validateForm = () => {
    if (!formData.name.trim()) {
      showToast('Campaign name is required', 'error');
      return false;
    }
    if (formData.name.length > 75) {
      showToast('Campaign name must be 75 characters or less', 'error');
      return false;
    }
    if (!formData.description.trim()) {
      showToast('Campaign description is required', 'error');
      return false;
    }
    if (formData.description.length > 300) {
      showToast('Campaign description must be 300 characters or less', 'error');
      return false;
    }
    if (!formData.deadlineToApply) {
      showToast('Deadline to apply is required', 'error');
      return false;
    }
    if (!formData.startDate) {
      showToast('Campaign start date is required', 'error');
      return false;
    }
    if (!formData.endDate) {
      showToast('Campaign end date is required', 'error');
      return false;
    }
    if (new Date(formData.startDate) >= new Date(formData.endDate)) {
      showToast('End date must be after start date', 'error');
      return false;
    }
    if (!formData.payoutRate || parseFloat(formData.payoutRate) <= 0) {
      showToast('Valid payout rate is required', 'error');
      return false;
    }
    if (!formData.totalBudget || parseFloat(formData.totalBudget) <= 0) {
      showToast('Valid total budget is required', 'error');
      return false;
    }
    if (!isBalanceSufficient) {
      showToast('Insufficient wallet balance. Please add funds.', 'error');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      // Create dummy campaign object
      const newCampaign = {
        id: `camp_${Date.now()}`,
        name: formData.name,
        description: formData.description,
        status: 'LIVE' as const,
        postedAt: new Date().toISOString().split('T')[0],
        deadlineToApply: formData.deadlineToApply,
        startDate: formData.startDate,
        endDate: formData.endDate,
        payoutRate: parseFloat(formData.payoutRate),
        totalBudget: parseFloat(formData.totalBudget),
        budgetUsed: 0,
        views: 0,
        targetViews: Math.floor(parseFloat(formData.totalBudget) / parseFloat(formData.payoutRate) * 1000),
        applicantsCount: 0,
        shortlistedCount: 0,
        brandAssetsUrl: formData.brandAssetsUrl || undefined,
      };

      // Add to dummy campaigns array
      let campaigns: any[] = [];
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(DUMMY_CAMPAIGNS_KEY);
        if (stored) {
          campaigns = JSON.parse(stored);
        }
        campaigns.push(newCampaign);
        localStorage.setItem(DUMMY_CAMPAIGNS_KEY, JSON.stringify(campaigns));
      }

      showToast('Campaign created successfully!', 'success');
      router.push('/brand/campaigns');
    } catch (error: any) {
      showToast(error.message || 'Failed to create campaign', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDraft = () => {
    if (!formData.name.trim()) {
      showToast('Campaign name is required to save draft', 'error');
      return;
    }

    // Save draft logic here
    const draft = {
      ...formData,
      id: `draft_${Date.now()}`,
      status: 'DRAFT' as const,
    };
    
    const drafts = JSON.parse(localStorage.getItem('campaign_drafts') || '[]');
    drafts.push(draft);
    localStorage.setItem('campaign_drafts', JSON.stringify(drafts));
    
    showToast('Draft saved successfully', 'success');
  };

  return (
    <div className="max-w-[1248px] mx-auto px-3 sm:px-6 md:px-[96px]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 sm:mb-6 md:mb-8 gap-4">
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/brand/campaigns" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
          </Link>
          <h1 className="font-heading text-xl sm:text-2xl md:text-3xl font-medium text-black">Create a Campaign</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={handleSaveDraft}
            disabled={isLoading}
            className="w-full md:w-auto"
          >
            Save as Draft
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={isLoading}
            className="w-full md:w-auto"
          >
            Launch Campaign
          </Button>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-card p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-6">
        {/* Campaign Name */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="font-heading text-sm font-medium text-black">
              Name of the Campaign
            </label>
            <span className="text-xs text-text-secondary">{formData.name.length} / 75 characters</span>
          </div>
          <input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value.slice(0, 75) })}
            placeholder="Enter campaign name"
            maxLength={75}
            required
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-sm font-heading font-normal text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86512] focus:border-transparent"
          />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="font-heading text-sm font-medium text-black">
              Description of the Campaign
            </label>
            <span className="text-xs text-text-secondary">{formData.description.length} / 300 characters</span>
          </div>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value.slice(0, 300) })}
            placeholder="Give a brief of the importance of AI and how you can gain best of AI tools knowledge to earn in lakhs."
            maxLength={300}
            rows={4}
            required
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl text-sm font-heading font-normal text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86512] focus:border-transparent resize-none"
          />
        </div>

        {/* Brand Assets URL */}
        <div>
          <label className="font-heading text-sm font-medium text-black mb-2 block">
            Attach URL with Brand Assets
          </label>
          <p className="text-xs text-text-secondary mb-2">
            (Please upload your assets/guidelines to google drive and make it accessible to public)
          </p>
          <div className="relative">
            <input
              value={formData.brandAssetsUrl}
              onChange={(e) => setFormData({ ...formData, brandAssetsUrl: e.target.value })}
              placeholder="<google drive link>"
              type="url"
              className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-xl text-sm font-heading font-normal text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86512] focus:border-transparent"
            />
            <Paperclip className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          </div>
        </div>

        {/* Deadline to Apply */}
        <div>
          <label className="font-heading text-sm font-medium text-black mb-2 block">
            Deadline to Apply
          </label>
          <div className="relative">
            <input
              value={formData.deadlineToApply}
              onChange={(e) => setFormData({ ...formData, deadlineToApply: e.target.value })}
              type="date"
              min={new Date().toISOString().split('T')[0]}
              required
              className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-xl text-sm font-heading font-normal text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86512] focus:border-transparent"
            />
            <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Campaign Start & End Date */}
        <div>
          <label className="font-heading text-sm font-medium text-black mb-2 block">
            Add Campaign Start & End Date
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <input
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                placeholder="Start Date"
                type="date"
                min={formData.deadlineToApply || new Date().toISOString().split('T')[0]}
                required
                className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-xl text-sm font-heading font-normal text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86512] focus:border-transparent"
              />
              <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            </div>
            <div className="relative">
              <input
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                placeholder="End Date"
                type="date"
                min={formData.startDate || new Date().toISOString().split('T')[0]}
                required
                className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-xl text-sm font-heading font-normal text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86512] focus:border-transparent"
              />
              <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Payout Rate */}
        <div>
          <label className="font-heading text-sm font-medium text-black mb-2 block">
            Payout Rate
          </label>
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium">₹</span>
            <input
              value={formData.payoutRate}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9.]/g, '');
                setFormData({ ...formData, payoutRate: value });
              }}
              placeholder="500"
              type="text"
              required
              className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-xl text-sm font-heading font-normal text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86512] focus:border-transparent"
            />
            <span className="text-sm text-text-secondary">/ 1000 views</span>
          </div>
        </div>

        {/* Total Budget */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="font-heading text-sm font-medium text-black">
              Total Budget of the Campaign
            </label>
            <div className="relative group">
              <Info className="w-4 h-4 text-gray-400 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                Once the budget is exhausted the campaign will end.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium">₹</span>
            <input
              value={formData.totalBudget}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9.]/g, '');
                setFormData({ ...formData, totalBudget: value });
              }}
              placeholder="50,000"
              type="text"
              required
              className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-xl text-sm font-heading font-normal text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86512] focus:border-transparent"
            />
          </div>
        </div>

        {/* Wallet Section */}
        <div className={cn(
          "rounded-xl p-4 md:p-6 border",
          isBalanceSufficient 
            ? "bg-green-50 border-green-200" 
            : "bg-red-50 border-red-200"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wallet className={cn("w-5 h-5", isBalanceSufficient ? "text-green-600" : "text-red-600")} />
              <span className="font-heading text-base font-medium text-black">My Wallet</span>
            </div>
            <div className="text-right">
              {isBalanceSufficient ? (
                <p className="text-green-600 font-medium">Good to go!</p>
              ) : budgetValue > walletBalance ? (
                <p className="text-red-600 font-medium">Insufficient Balance!</p>
              ) : (
                <p className="text-gray-600 font-medium">Enter budget amount</p>
              )}
              <p className="text-sm text-text-secondary mt-1">
                Current Balance: ₹ {walletBalance.toLocaleString('en-IN')}
              </p>
            </div>
          </div>
          {budgetValue > walletBalance && (
            <Link
              href="/brand/wallet"
              className="mt-4 inline-flex items-center gap-2 text-[#E86512] hover:underline text-sm font-medium"
            >
              <Wallet className="w-4 h-4" />
              Make Payment
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
