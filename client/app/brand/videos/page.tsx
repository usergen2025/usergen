'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export default function BrandVideosPage() {
  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-6 lg:px-8">
      <div className="flex items-center gap-4 mb-6 md:mb-8">
        <Link href="/brand/dashboard" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-black" />
        </Link>
        <h1 className="font-heading text-2xl md:text-3xl font-medium text-black">My Videos</h1>
      </div>

      <div className="bg-white rounded-2xl shadow-card p-8 md:p-12 text-center">
        <p className="text-text-secondary text-lg">My Videos page coming soon...</p>
      </div>
    </div>
  );
}

