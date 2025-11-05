'use client';

import Link from 'next/link';
import { Play, Sparkles, TrendingUp } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import BottomNavigation from '@/components/layout/BottomNavigation';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';

export default function DashboardPage() {
  const credits = 4100;
  const earnings = 4000;
  const avatarUsed = 20;

  const projects = Array.from({ length: 3 }, (_, i) => ({
    id: `project-${i}`,
    title: 'Video',
    duration: '01:30 min',
  }));

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Welcome Section */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className={cn(typography.heading.h3)}>Hi Jane</h1>
              <p className={cn(typography.body.base, "text-text-secondary")}>Welcome back</p>
            </div>
            <Button variant="outline" size="sm">
              ¢{credits} +
            </Button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Card className="p-4">
              <p className="text-sm text-text-secondary mb-1">Earnings</p>
              <p className={cn(typography.heading.h4)}>¢{earnings}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-text-secondary mb-1">Avatar used</p>
              <p className={cn(typography.heading.h4)}>{avatarUsed}</p>
            </Card>
            <Card className="p-4 cursor-pointer hover:border-primary">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                <p className="font-medium">MY AVATAR</p>
              </div>
            </Card>
            <Card className="p-4 bg-primary text-secondary cursor-pointer hover:opacity-90">
              <div className="flex items-center gap-2">
                <Play className="w-5 h-5" />
                <p className="font-medium">Generate Video</p>
              </div>
            </Card>
          </div>

          {/* Info Section */}
          <Card className="p-8 mb-8 text-center">
            <h3 className={cn(typography.heading.h5, "mb-2")}>
              What's New | Fun Facts | AI Suggestions
            </h3>
          </Card>

          {/* Recent Projects */}
          <div className="flex items-center justify-between mb-4">
            <h2 className={cn(typography.heading.h4)}>Recent Projects</h2>
            <Link href="/dashboard/projects" className="text-primary text-sm">
              See all
            </Link>
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
        </div>
      </div>
      
      <BottomNavigation />
    </div>
  );
}


