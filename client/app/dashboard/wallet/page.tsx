'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy mock wallet route — redirect to real billing. */
export default function WalletPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/billing?action=add');
  }, [router]);

  return (
    <div className="flex min-h-[40dvh] items-center justify-center text-sm text-gray-500">
      Redirecting to billing…
    </div>
  );
}
