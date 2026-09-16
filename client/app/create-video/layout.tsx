'use client';

import AuthGuard from '@/components/auth/AuthGuard';
import ClassicFunnelTracker from '@/components/analytics/ClassicFunnelTracker';

export default function CreateVideoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <ClassicFunnelTracker />
      {children}
    </AuthGuard>
  );
}
