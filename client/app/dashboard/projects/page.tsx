'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';
import Card from '@/components/ui/Card';
import BottomNavigation from '@/components/layout/BottomNavigation';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';

export default function ProjectsPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'draft' | 'completed'>('all');

  const projects = Array.from({ length: 10 }, (_, i) => ({
    id: `project-${i}`,
    title: 'Video',
    duration: '01:30 min',
  }));

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <h1 className={cn(typography.heading.h3, "mb-6")}>My Projects</h1>

          {/* Tabs */}
          <div className="flex gap-4 mb-6 border-b border-border">
            {(['all', 'draft', 'completed'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-2 capitalize border-b-2 transition-colors',
                  activeTab === tab
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-text-secondary'
                )}
              >
                {tab === 'draft' ? 'In Draft' : tab}
              </button>
            ))}
          </div>

          {/* Projects Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {projects.map((project) => (
              <Card key={project.id} className="p-4 cursor-pointer hover:border-primary">
                <div className="aspect-video bg-primary-light rounded mb-3 flex items-center justify-center relative">
                  <Play className="w-8 h-8 text-text-muted" />
                  <button className="absolute top-2 right-2">
                    <span className="text-text-muted">⭐</span>
                  </button>
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

