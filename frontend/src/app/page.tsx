'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Spinner } from '@/components/ui';

/** Entry point — route to the dashboard, setup, or sign-in as appropriate. */
export default function Home() {
  const router = useRouter();
  const { user, farms, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (farms.length === 0) router.replace('/onboarding');
    else router.replace('/dashboard');
  }, [user, farms, loading, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="h-8 w-8 text-brand-600" />
    </div>
  );
}
