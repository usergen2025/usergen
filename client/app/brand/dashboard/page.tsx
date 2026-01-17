'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';
import { Briefcase, Megaphone, Eye, IndianRupee, TrendingUp } from 'lucide-react';
import { useRouter } from 'next/navigation';

const DUMMY_CAMPAIGNS_KEY = 'dummy_campaigns';

export default function BrandDashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [dateRange, setDateRange] = useState('7d');
  const [stats, setStats] = useState({
    totalCampaigns: 0,
    liveCampaigns: 0,
    totalViews: 0,
    spentSoFar: 0,
    walletBalance: 50000,
  });

  useEffect(() => {
    calculateStats();
  }, [dateRange]);

  const calculateStats = () => {
    try {
      // Load campaigns from localStorage
      let allCampaigns: any[] = [];
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(DUMMY_CAMPAIGNS_KEY);
        if (stored) {
          allCampaigns = JSON.parse(stored);
        }
      }

      // Calculate stats based on campaigns
      const totalCampaigns = allCampaigns.length;
      const liveCampaigns = allCampaigns.filter(c => c.status === 'LIVE' || c.status === 'IN_PROGRESS').length;
      const totalViews = allCampaigns.reduce((sum, c) => sum + (c.views || 0), 0);
      const spentSoFar = allCampaigns.reduce((sum, c) => sum + (c.budgetUsed || 0), 0);
      
      // Wallet balance (could also be stored separately)
      const walletBalance = 50000 - spentSoFar;

      setStats({
        totalCampaigns,
        liveCampaigns,
        totalViews,
        spentSoFar,
        walletBalance: Math.max(0, walletBalance),
      });
    } catch (error) {
      console.error('Error calculating stats:', error);
    }
  };

  const brandName = (user as any)?.brandName || user?.name || 'Brand';

  return (
    <div className="max-w-[1248px] mx-auto px-3 sm:px-6 md:px-[96px]">
      {/* Welcome Section */}
      <div className="mb-4 sm:mb-6 md:mb-8">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 flex items-center justify-center bg-gradient-to-b from-[#E86412] to-[#F12A4C] rounded-full text-white font-heading font-medium text-lg sm:text-xl md:text-2xl">
            {brandName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="font-heading text-xl sm:text-2xl md:text-3xl font-normal text-black">
              Hello {brandName},
            </h1>
            <p className="font-heading text-base sm:text-lg md:text-xl text-black">Welcome to UserGen!</p>
          </div>
        </div>
      </div>

      {/* Dashboard Stats Section */}
      <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6 md:p-8 mb-4 sm:mb-6 md:mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 sm:mb-6">
          <h2 className="font-heading text-lg sm:text-xl md:text-2xl font-medium text-black mb-4 md:mb-0">
            Dashboard Stats
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-4 py-2 border border-border-light rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#E86512]"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
          <StatCard
            icon={<Briefcase className="w-5 h-5 md:w-6 md:h-6 text-[#E86512]" />}
            value={stats.totalCampaigns.toString()}
            label="Total Campaigns"
          />
          <StatCard
            icon={<Megaphone className="w-5 h-5 md:w-6 md:h-6 text-[#E86512]" />}
            value={stats.liveCampaigns.toString()}
            label="Live Campaigns"
          />
          <StatCard
            icon={<Eye className="w-5 h-5 md:w-6 md:h-6 text-[#E86512]" />}
            value={`${(stats.totalViews / 1000).toFixed(1)}k`}
            label="Total Views"
          />
          <StatCard
            icon={<IndianRupee className="w-5 h-5 md:w-6 md:h-6 text-[#E86512]" />}
            value={`₹ ${stats.spentSoFar.toLocaleString('en-IN')}`}
            label="Spent So Far"
          />
        </div>

        {/* Create Campaign CTA */}
        <div className="flex justify-center">
          <Button
            variant="primary"
            size="lg"
            onClick={() => router.push('/brand/campaigns/create')}
            className="w-full md:w-auto"
          >
            <div className="flex items-center gap-2">
              <span>Create your first Campaign</span>
            </div>
          </Button>
        </div>
      </div>

      {/* Wallet Section */}
      <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6 md:p-8 mb-4 sm:mb-6 md:mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <IndianRupee className="w-4 h-4 sm:w-5 sm:h-5 text-[#E86512]" />
            <h3 className="font-heading text-base sm:text-lg md:text-xl font-medium text-black">My Wallet</h3>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push('/brand/wallet')}
          >
            Add Funds
          </Button>
        </div>
        <div className="text-xl sm:text-2xl md:text-3xl font-heading font-medium text-black">
          Current Balance: ₹ {stats.walletBalance.toLocaleString('en-IN')}
        </div>
      </div>

      {/* Chart Placeholder */}
      <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6 md:p-8">
        <h3 className="font-heading text-base sm:text-lg md:text-xl font-medium text-black mb-4">
          Campaign Performance
        </h3>
        <div className="h-48 sm:h-64 md:h-80 flex items-center justify-center bg-gray-50 rounded-xl">
          <div className="text-center">
            <TrendingUp className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-gray-400 mx-auto mb-2" />
            <p className="text-sm sm:text-base text-text-secondary">Chart will be displayed here</p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  value: string;
  label: string;
}

function StatCard({ icon, value, label }: StatCardProps) {
  return (
    <div className="bg-gradient-to-br from-orange-50 to-pink-50 rounded-xl p-3 sm:p-4 md:p-6">
      <div className="flex items-center gap-2 sm:gap-3 mb-2">
        {icon}
        <h3 className="font-heading text-base sm:text-lg md:text-2xl font-medium text-black">
          {value}
        </h3>
      </div>
      <p className="font-sans text-xs sm:text-sm md:text-base text-text-secondary">
        {label}
      </p>
    </div>
  );
}
