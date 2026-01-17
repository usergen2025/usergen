'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import { ArrowLeft, Calendar, Eye, IndianRupee, Users, Edit, Filter, ArrowUpDown, Plus } from 'lucide-react';

type CampaignStatus = 'LIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'DRAFT';

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  postedAt: string;
  deadlineToApply: string;
  startDate: string;
  endDate: string;
  payoutRate: number;
  totalBudget: number;
  budgetUsed: number;
  views: number;
  targetViews: number;
  applicantsCount: number;
  shortlistedCount: number;
}

const DUMMY_CAMPAIGNS_KEY = 'dummy_campaigns';

// Initialize with some default dummy campaigns
const getDefaultDummyCampaigns = (): Campaign[] => [
  {
    id: 'camp_1',
    name: 'Summer Collection Launch 2024',
    description: 'Promote our new summer collection across Instagram and TikTok. Looking for creators with a strong fashion sense.',
    status: 'LIVE',
    postedAt: '2025-01-10',
    deadlineToApply: '2025-01-25',
    startDate: '2025-02-01',
    endDate: '2025-02-28',
    payoutRate: 500,
    totalBudget: 50000,
    budgetUsed: 12500,
    views: 25000,
    targetViews: 100000,
    applicantsCount: 15,
    shortlistedCount: 8,
  },
  {
    id: 'camp_2',
    name: 'Holiday Season Promo Campaign',
    description: 'Spread the word about our holiday special offers. Content creators needed for festive content.',
    status: 'IN_PROGRESS',
    postedAt: '2025-01-05',
    deadlineToApply: '2025-01-20',
    startDate: '2025-01-25',
    endDate: '2025-02-15',
    payoutRate: 400,
    totalBudget: 40000,
    budgetUsed: 18000,
    views: 45000,
    targetViews: 100000,
    applicantsCount: 22,
    shortlistedCount: 12,
  },
  {
    id: 'camp_3',
    name: 'New Product Teaser Campaign',
    description: 'Create buzz around our upcoming product launch. Innovative creators welcome!',
    status: 'COMPLETED',
    postedAt: '2024-12-20',
    deadlineToApply: '2024-12-31',
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    payoutRate: 600,
    totalBudget: 60000,
    budgetUsed: 60000,
    views: 120000,
    targetViews: 100000,
    applicantsCount: 35,
    shortlistedCount: 20,
  },
];

export default function CampaignsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'live' | 'inProgress' | 'completed'>('live');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCampaigns();
  }, [activeTab]);

  const loadCampaigns = () => {
    setIsLoading(true);
    try {
      // Load from localStorage or use defaults
      let allCampaigns: Campaign[] = [];
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(DUMMY_CAMPAIGNS_KEY);
        if (stored) {
          allCampaigns = JSON.parse(stored);
        } else {
          // Initialize with defaults and save
          allCampaigns = getDefaultDummyCampaigns();
          localStorage.setItem(DUMMY_CAMPAIGNS_KEY, JSON.stringify(allCampaigns));
        }
      } else {
        allCampaigns = getDefaultDummyCampaigns();
      }

      // Filter by active tab
      let filtered: Campaign[] = [];
      if (activeTab === 'live') {
        filtered = allCampaigns.filter(c => c.status === 'LIVE');
      } else if (activeTab === 'inProgress') {
        filtered = allCampaigns.filter(c => c.status === 'IN_PROGRESS');
      } else if (activeTab === 'completed') {
        filtered = allCampaigns.filter(c => c.status === 'COMPLETED');
      }

      setCampaigns(filtered);
    } catch (error: any) {
      showToast('Failed to load campaigns', 'error');
      setCampaigns([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate counts for tabs
  const getAllCampaigns = (): Campaign[] => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(DUMMY_CAMPAIGNS_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    }
    return getDefaultDummyCampaigns();
  };

  const allCampaigns = getAllCampaigns();
  const liveCount = allCampaigns.filter(c => c.status === 'LIVE').length;
  const inProgressCount = allCampaigns.filter(c => c.status === 'IN_PROGRESS').length;
  const completedCount = allCampaigns.filter(c => c.status === 'COMPLETED').length;

  const tabs = [
    { id: 'live' as const, label: 'Live Campaigns', count: liveCount },
    { id: 'inProgress' as const, label: 'In Progress', count: inProgressCount },
    { id: 'completed' as const, label: 'Completed', count: completedCount },
  ];

  return (
    <div className="max-w-[1248px] mx-auto px-3 sm:px-6 md:px-[96px]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 sm:mb-6 md:mb-8 gap-4">
        <div className="flex items-center gap-4">
          <Link href="/brand/dashboard" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-black" />
          </Link>
          <h1 className="font-heading text-xl sm:text-2xl md:text-3xl font-medium text-black">My Campaigns</h1>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => router.push('/brand/campaigns/create')}
          className="w-full md:w-auto"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create a Campaign
        </Button>
      </div>

      {/* Tabs and Filters */}
      <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6 mb-4 sm:mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors',
                  activeTab === tab.id
                    ? 'bg-[#E86512] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
              <Filter className="w-4 h-4" />
              Filter
            </button>
            <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
              <ArrowUpDown className="w-4 h-4" />
              Sort
            </button>
          </div>
        </div>

        {/* Campaigns List */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-text-secondary">Loading campaigns...</p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-12">
            <div className="bg-gradient-to-br from-orange-50 to-pink-50 rounded-2xl p-8 md:p-12 mb-4 border-2 border-dashed border-orange-200">
              <p className="font-heading text-lg md:text-xl text-black mb-4">No campaigns to show here.</p>
              <Button
                variant="primary"
                size="md"
                onClick={() => router.push('/brand/campaigns/create')}
                className="mx-auto"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create a Campaign
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper functions
function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDaysRemaining(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const daysRemaining = getDaysRemaining(campaign.deadlineToApply);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 hover:shadow-lg transition-shadow">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-heading text-lg md:text-xl font-medium text-black mb-1">
                {campaign.name}
              </h3>
              <p className="text-sm text-text-secondary mb-2">
                Posted on: {formatDate(campaign.postedAt)}
              </p>
            </div>
            <span
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-medium',
                campaign.status === 'LIVE' && 'bg-red-100 text-red-700',
                campaign.status === 'IN_PROGRESS' && 'bg-orange-100 text-orange-700',
                campaign.status === 'COMPLETED' && 'bg-gray-100 text-gray-700'
              )}
            >
              {campaign.status === 'IN_PROGRESS' ? 'IN PROGRESS' : campaign.status}
            </span>
          </div>

          <p className="text-sm text-text-secondary mb-4 line-clamp-2">{campaign.description}</p>

          <div className="flex flex-wrap gap-4 md:gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-[#E86512]" />
              <span className="text-black">
                {campaign.views.toLocaleString()} / {campaign.targetViews.toLocaleString()} views
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#E86512]" />
              <span className="text-black">
                Applicants: {campaign.applicantsCount}
              </span>
              {campaign.shortlistedCount > 0 && (
                <span className="text-green-600 ml-2">
                  Shortlisted: {campaign.shortlistedCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#E86512]" />
              <span className={cn('text-black', daysRemaining < 0 && 'text-red-600')}>
                Deadline: {formatDate(campaign.deadlineToApply)}
                {daysRemaining >= 0 && ` - ${daysRemaining} days to go!`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-[#E86512]" />
              <span className="text-black">
                Budget: ₹{campaign.budgetUsed.toLocaleString()} / ₹{campaign.totalBudget.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => router.push(`/brand/campaigns/${campaign.id}`)}
            className="w-full md:w-auto"
          >
            View Details
          </Button>
          {campaign.status !== 'COMPLETED' && (
            <button
              onClick={() => router.push(`/brand/campaigns/${campaign.id}/edit`)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#E86512] hover:bg-orange-50 rounded-xl transition-colors"
            >
              <Edit className="w-4 h-4" />
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
