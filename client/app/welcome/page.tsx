'use client';

import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { Play, User } from 'lucide-react';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';

export default function WelcomePage() {
  const router = useRouter();

  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-center px-4 py-12">
        <div className="max-w-md w-full text-center space-y-8">
        <h1 className={cn(typography.heading.h2, "mb-6")}>
          Bring Your Ideas to Life with AI
        </h1>
        
        {/* Central graphic with avatars */}
        <div className="relative w-64 h-64 mx-auto mb-8 flex items-center justify-center">
          <div className="absolute w-full h-full border-2 border-dashed border-border rounded-full" />
          <div className="absolute w-3/4 h-3/4 border-2 border-dashed border-border rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center">
              <Play className="w-10 h-10 text-secondary" fill="currentColor" />
            </div>
          </div>
          {/* Avatar icons positioned around */}
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                transform: `rotate(${i * 120}deg) translateY(-120px)`,
              }}
            >
              <User className="w-8 h-8" />
            </div>
          ))}
        </div>

        <p className={cn(typography.body.large, "mb-8 font-bold")}>
          Make your 1st video now!
        </p>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => router.push('/create-video/ai-chat')}
        >
          LETS CREATE A VIDEO
        </Button>
      </div>
    </div>
  );
}

