'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { ArrowLeft, IndianRupee, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const DUMMY_CAMPAIGNS_KEY = 'dummy_campaigns';

export default function BrandWalletPage() {
  const [walletBalance, setWalletBalance] = useState(50000);

  useEffect(() => {
    calculateWalletBalance();
  }, []);

  const calculateWalletBalance = () => {
    try {
      // Load campaigns from localStorage
      let allCampaigns: any[] = [];
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(DUMMY_CAMPAIGNS_KEY);
        if (stored) {
          allCampaigns = JSON.parse(stored);
        }
      }

      // Calculate spent amount
      const spentSoFar = allCampaigns.reduce((sum, c) => sum + (c.budgetUsed || 0), 0);
      
      // Wallet balance (initial balance - spent)
      const balance = 50000 - spentSoFar;
      setWalletBalance(Math.max(0, balance));
    } catch (error) {
      console.error('Error calculating wallet balance:', error);
    }
  };

  return (
    <div className="max-w-[1248px] mx-auto px-3 sm:px-6 md:px-[96px]">
      <div className="flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6 md:mb-8">
        <Link href="/brand/dashboard" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
        </Link>
        <h1 className="font-heading text-xl sm:text-2xl md:text-3xl font-medium text-black">My Wallet</h1>
      </div>

      <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6 md:p-8">
        <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
          <Wallet className="w-5 h-5 sm:w-6 sm:h-6 text-[#E86512]" />
          <h2 className="font-heading text-lg sm:text-xl md:text-2xl font-medium text-black">Wallet Balance</h2>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-pink-50 rounded-xl p-4 sm:p-6 md:p-8 mb-4 sm:mb-6">
          <p className="text-xs sm:text-sm text-text-secondary mb-2">Current Balance</p>
          <p className="text-2xl sm:text-3xl md:text-4xl font-heading font-medium text-black flex items-center gap-2">
            <IndianRupee className="w-6 h-6 sm:w-8 sm:h-8" />
            {walletBalance.toLocaleString('en-IN')}
          </p>
        </div>

        <Button variant="primary" size="md" className="w-full md:w-auto">
          Add Funds
        </Button>

        {/* Transaction History */}
        <div className="mt-6 sm:mt-8">
          <h3 className="font-heading text-base sm:text-lg md:text-xl font-medium text-black mb-4">Transaction History</h3>
          <div className="text-center py-6 sm:py-8 text-sm sm:text-base text-text-secondary">
            No transactions yet
          </div>
        </div>
      </div>
    </div>
  );
}

