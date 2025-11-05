'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Circle, User, LogOut } from 'lucide-react';
import Button from '@/components/ui/Button';
import Dropdown, { DropdownItem } from '@/components/ui/Dropdown';
import { useAuth } from '@/hooks/useAuth';

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, isAuthenticated } = useAuth();
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  // Redirect /dashboard routes to main routes
  useEffect(() => {
    if (pathname?.startsWith('/dashboard')) {
      if (pathname === '/dashboard' || pathname === '/dashboard/projects') {
        router.replace('/projects');
      } else if (pathname === '/dashboard/profile') {
        router.replace('/profile');
      }
    }
  }, [pathname, router]);

  return (
    <header className="bg-secondary border-b border-border sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Circle className="w-8 h-8 text-primary-light" fill="currentColor" />
          <span className="text-xl font-bold text-primary">UserGen.ai</span>
        </Link>

        <div className="flex items-center gap-4">
          {!isAuthPage && (
            <nav className="hidden md:flex items-center gap-6">
              <Link href="/" className="text-base text-text-primary hover:text-text-secondary transition-colors">
                Home
              </Link>
              {isAuthenticated && (
                <Link href="/projects" className="text-base text-text-primary hover:text-text-secondary transition-colors">
                  Projects
                </Link>
              )}
              <Link href="/about" className="text-base text-text-primary hover:text-text-secondary transition-colors">
                About Us
              </Link>
              <Link href="/contact" className="text-base text-text-primary hover:text-text-secondary transition-colors">
                Contact
              </Link>
            </nav>
          )}
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                <Link href="/create-video/style">
                  <Button variant="primary" size="sm">Create Video</Button>
                </Link>
                <Dropdown
                  trigger={
                    <button className="p-2 hover:bg-primary-light rounded-md transition-colors">
                      <User className="w-5 h-5" />
                    </button>
                  }
                  align="right"
                >
                  <DropdownItem onClick={handleLogout} icon={<LogOut className="w-5 h-5" />}>
                    Logout
                  </DropdownItem>
                </Dropdown>
              </>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="outline" size="sm">Login</Button>
                </Link>
                <Link href="/create-video/style">
                  <Button variant="primary" size="sm">Create Video</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}


