'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';

interface ConditionalHeaderProps {
  position?: 'fixed' | 'relative' | 'sticky';
}

export default function ConditionalHeader({ position = 'fixed' }: ConditionalHeaderProps) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isAIChatPage = pathname === '/create-video/ai-chat';
  
  // Don't show header on auth pages (they have overlay design)
  if (isAuthPage) {
    return null;
  }
  
  // Use relative positioning for AI chat page to prevent overlap
  const headerPosition = isAIChatPage ? 'relative' : position;
  
  return <Header position={headerPosition} />;
}

