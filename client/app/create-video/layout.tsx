'use client';

import AuthGuard from '@/components/auth/AuthGuard';

export default function CreateVideoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthGuard>{children}</AuthGuard>;
}
