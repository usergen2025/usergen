'use client';

import { User } from 'lucide-react';
import Input from '@/components/ui/Input';
import BottomNavigation from '@/components/layout/BottomNavigation';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import Link from 'next/link';

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <h1 className={cn(typography.heading.h3, "mb-6")}>Profile</h1>

          {/* Profile Picture */}
          <div className="flex justify-center mb-8">
            <div className="w-24 h-24 rounded-full border-2 border-border flex items-center justify-center bg-primary-light">
              <User className="w-12 h-12 text-text-muted" />
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4 mb-6">
            <Input placeholder="Name" />
            <Input placeholder="Mobile" />
            <Input placeholder="Email ID" type="email" />
            <Input placeholder="Social Media Link" type="url" />
            <Input placeholder="My Goal" />
          </div>

          {/* Links */}
          <div className="space-y-2">
            <Link href="/logout" className="block text-primary hover:underline">
              Logout
            </Link>
            <Link href="/privacy" className="block text-primary hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="block text-primary hover:underline">
              Terms & Conditions
            </Link>
          </div>
        </div>
      </div>
      
      <BottomNavigation />
    </div>
  );
}


