'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X, LogOut } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';
import Dropdown, { DropdownItem } from '@/components/ui/Dropdown';

interface BrandHeaderProps {
  position?: 'fixed' | 'relative' | 'sticky';
}

export default function BrandHeader({ position = 'relative' }: BrandHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  const isActive = (href: string) => pathname === href;

  const navItems = [
    { href: '/brand/dashboard', label: 'Home' },
    { href: '/brand/campaigns', label: 'My Campaigns' },
    { href: '/brand/videos', label: 'My Videos' },
    { href: '/brand/wallet', label: 'My Wallet' },
  ];

  // Get brand name from user
  const brandName = (user as any)?.brandName || user?.name || 'Brand';

  const positionClasses = {
    fixed: 'fixed top-0 left-0 right-0 z-50',
    sticky: 'sticky top-0 z-50',
    relative: 'relative'
  };

  return (
    <header className={cn(positionClasses[position], "w-full pt-[43px] pb-0")}>
      <div className="max-w-[1248px] mx-auto px-4 sm:px-6">
        <div className="bg-white shadow-header rounded-2xl px-4 md:px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/brand/dashboard" className="flex items-center flex-shrink-0">
              <BrandLogo showBrandLabel={true} />
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 md:px-4 py-2 md:py-3 rounded-xl text-sm font-medium transition-colors whitespace-nowrap",
                    isActive(item.href)
                      ? "text-[#E86512] bg-orange-50"
                      : "text-[#0F082B] hover:text-[#E86512] hover:bg-orange-50/50"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right Side - User Profile */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {user && (
                <Dropdown
                  trigger={
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-[26px] cursor-pointer hover:opacity-80 transition-opacity">
                      <div className="w-8 h-8 flex items-center justify-center bg-gradient-to-b from-[#E86412] to-[#F12A4C] rounded-full text-white font-heading font-medium text-sm flex-shrink-0">
                        {brandName.charAt(0).toUpperCase()}
                      </div>
                      <span className="hidden sm:block text-sm font-heading font-medium text-[#9E9E9E] whitespace-nowrap">
                        {brandName}
                      </span>
                    </div>
                  }
                  align="right"
                >
                  <DropdownItem onClick={handleLogout} icon={<LogOut className="w-5 h-5" />}>
                    Logout
                  </DropdownItem>
                </Dropdown>
              )}

              {/* Mobile Menu Button */}
              <button
                className="md:hidden p-2 flex-shrink-0"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6 text-black" />
                ) : (
                  <Menu className="w-6 h-6 text-black" />
                )}
              </button>
            </div>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 pt-4 border-t border-gray-200">
              <nav className="flex flex-col gap-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                      isActive(item.href)
                        ? "text-[#E86512] bg-orange-50"
                        : "text-[#0F082B]"
                    )}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

