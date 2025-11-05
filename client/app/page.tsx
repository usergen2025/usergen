'use client';

import Link from 'next/link';
import Button from '@/components/ui/Button';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { useAuth } from '@/hooks/useAuth';

export default function HomePage() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 md:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-6">
            <h1 className={cn(typography.heading.h1, "max-w-2xl")}>
              Landing page title comes here...
            </h1>
            <p className={cn(typography.body.large, "text-text-secondary max-w-xl")}>
              Landing page body text comes here...
            </p>
            <Link href="/create-video/style">
              <Button variant="primary" size="lg" className="mt-6">
                {isLoading ? 'Loading...' : (isAuthenticated ? 'CREATE A VIDEO NOW' : 'CREATE MY FIRST VIDEO')}
              </Button>
            </Link>
          </div>

          {/* Right Hero Image */}
          <div className="bg-secondary border border-border rounded-lg p-12 flex items-center justify-center min-h-[400px]">
            <p className="text-text-muted text-lg">Hero Image</p>
          </div>
        </div>
      </div>
    </div>
  );
}
