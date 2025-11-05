'use client';

import { Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import BottomNavigation from '@/components/layout/BottomNavigation';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';

export default function WalletPage() {
  const balance = 4100;

  const transactions = [
    { id: '1', description: 'Video Creation', amount: -100, date: '10/09/2025', time: '01:30 PM' },
    { id: '2', description: 'Avatar Used', amount: 300, date: '10/09/2025', time: '01:30 PM' },
    { id: '3', description: 'Received credits for sharing video', amount: 50, date: '10/09/2025', time: '01:30 PM' },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className={cn(typography.heading.h3, "mb-6")}>Wallet</h1>

          {/* Balance */}
          <Card className="p-8 mb-6 text-center">
            <p className="text-sm text-text-secondary mb-2">Current Balance</p>
            <p className={cn(typography.heading.h2)}>${balance}</p>
          </Card>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <Button variant="outline" size="lg" icon={<Sparkles className="w-5 h-5" />}>
              ADD MONEY
            </Button>
            <Button variant="outline" size="lg" icon={<Sparkles className="w-5 h-5" />}>
              WITHDRAW MONEY
            </Button>
          </div>

          {/* Transactions */}
          <h2 className={cn(typography.heading.h5, "mb-4")}>All transactions</h2>
          <div className="space-y-3">
            {transactions.map((tx) => (
              <Card key={tx.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{tx.description}</p>
                    <p className="text-sm text-text-secondary">{tx.date} | {tx.time}</p>
                  </div>
                  <p className={cn(
                    'font-medium',
                    tx.amount > 0 ? 'text-green-600' : 'text-red-600'
                  )}>
                    {tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount)}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
      
      <BottomNavigation />
    </div>
  );
}


