'use client';

import Link from 'next/link';
import { Play, Wallet, Eye, BadgeCheck, Rocket, IndianRupee } from 'lucide-react';
import { BrandPrimaryButton, BrandSecondaryButton, BrandStatStrip } from '@/components/brand';
import Card from '@/components/ui/Card';
import BottomNavigation from '@/components/layout/BottomNavigation';

export default function DashboardPage() {
  const walletBalance = 4100;
  const projects = Array.from({ length: 3 }, (_, i) => ({
    id: `project-${i}`,
    title: `Campaign video ${i + 1}`,
    duration: '01:30 min',
  }));

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-8 overflow-x-hidden">
      <div className="brand-page-shell py-6">
        <div className="brand-gradient-frame rounded-[20px] p-[2px] mb-4">
          <div className="brand-surface-card rounded-[18px] border-0 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h1 className="brand-campaign-page-title">Hey John</h1>
                <p className="brand-campaign-meta">Your creator campaigns and earnings at a glance.</p>
              </div>
              <BrandSecondaryButton size="sm" className="inline-flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                ₹{walletBalance.toLocaleString('en-IN')}
              </BrandSecondaryButton>
            </div>
            <BrandStatStrip
              layout="inline"
              items={[
                { value: '12', label: 'Applied', Icon: Rocket },
                { value: '5', label: 'Approved', Icon: BadgeCheck },
                { value: '3', label: 'Live', Icon: Play },
                { value: '82k', label: 'Total Views', Icon: Eye },
                { value: '9,400', label: 'Earned So Far', Icon: IndianRupee },
              ]}
            />
          </div>
        </div>

        <Card className="brand-surface-card brand-surface-card--compact p-4 sm:p-5 border-0 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="brand-page-section-title">In Campaign</h2>
            <Link href="/campaigns" className="brand-text-link">See all</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {[1, 2].map((x) => (
              <div key={x} className="rounded-xl border border-[#E8E2DB] p-3">
                <p className="font-heading text-sm font-medium text-[#212121]">Brand challenge #{x}</p>
                <p className="brand-campaign-meta mt-1">Deadline: 26 Apr 2026</p>
                <div className="mt-2 flex gap-2">
                  <BrandSecondaryButton size="sm">View brief</BrandSecondaryButton>
                  <BrandPrimaryButton size="sm">Attach video</BrandPrimaryButton>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="brand-surface-card brand-surface-card--compact p-4 sm:p-5 border-0 mb-4">
          <h2 className="brand-page-section-title mb-3">Apply to Campaigns</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {[1, 2].map((x) => (
              <div key={x} className="rounded-xl border border-[#E8E2DB] p-3">
                <p className="font-heading text-sm font-medium text-[#212121]">Growth campaign #{x}</p>
                <p className="brand-campaign-meta mt-1">CPM: ₹500 / 1000 views</p>
                <BrandPrimaryButton size="sm" className="mt-3">Apply</BrandPrimaryButton>
              </div>
            ))}
          </div>
        </Card>

        <Card className="brand-surface-card brand-surface-card--compact p-4 sm:p-5 border-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="brand-page-section-title">Recent Projects</h2>
            <Link href="/dashboard/projects" className="brand-text-link">See all</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {projects.map((project) => (
              <Card key={project.id} className="p-4 cursor-pointer hover:border-primary">
                <div className="aspect-video bg-primary-light rounded mb-3 flex items-center justify-center">
                  <Play className="w-8 h-8 text-text-muted" />
                </div>
                <p className="font-medium">{project.title}</p>
                <p className="text-sm text-text-secondary">{project.duration}</p>
              </Card>
            ))}
          </div>
        </Card>
      </div>
      <BottomNavigation />
    </div>
  );
}


