'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, LogOut, Menu, X, Wallet, Briefcase, Video, Megaphone, Receipt } from 'lucide-react';
import CreditDisplay from '@/components/billing/CreditDisplay';
import BrandBalanceDisplay from '@/components/billing/BrandBalanceDisplay';
import Image from 'next/image';
import Button from '@/components/ui/Button';
import Dropdown, { DropdownItem } from '@/components/ui/Dropdown';
import { useAuth } from '@/hooks/useAuth';
import { useCloseOnRouteChange } from '@/hooks/useCloseOnRouteChange';
import { cn } from '@/lib/utils/cn';
import LoginModal from '@/components/auth/LoginModal';
import GetStartedModal from '@/components/auth/GetStartedModal';
import BrandSignupModal from '@/components/auth/BrandSignupModal';
import CreatorSignupModal from '@/components/auth/CreatorSignupModal';
import BrandLogo from '@/components/layout/BrandLogo';
import NotificationBell from '@/components/layout/NotificationBell';
import { apiClient, User } from '@/lib/api/client';

interface HeaderProps {
  position?: 'fixed' | 'relative' | 'sticky';
  /** Softer bar so global body gradient reads through (workspace / gradient-first pages). */
  floatingBarSurface?: 'solid' | 'translucent';
}

export default function Header({ position = 'fixed', floatingBarSurface = 'solid' }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, isAuthenticated, user: authUser, isBrand } = useAuth();
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [getStartedModalOpen, setGetStartedModalOpen] = useState(false);
  const [brandSignupModalOpen, setBrandSignupModalOpen] = useState(false);
  const [creatorSignupModalOpen, setCreatorSignupModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useCloseOnRouteChange(() => setMobileMenuOpen(false));

  // Use authUser from useAuth hook, fallback to fetched user
  const currentUser = authUser || user;
  const userIsBrand = isBrand();

  const handleCreateVideoClick = () => {
    if (isAuthenticated) {
      router.push('/create-video/ai-chat');
    } else {
      // Set flag to indicate user came from "Create a Video" button
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('fromCreateVideo', 'true');
      }
      setGetStartedModalOpen(true);
    }
  };

  const handleSelectCreator = () => {
    setGetStartedModalOpen(false);
    setCreatorSignupModalOpen(true);
  };

  const handleSelectBrand = () => {
    setGetStartedModalOpen(false);
    setBrandSignupModalOpen(true);
  };

  const handleShowLogin = () => {
    setGetStartedModalOpen(false);
    setBrandSignupModalOpen(false);
    setCreatorSignupModalOpen(false);
    // Don't clear the flag here - it should persist if coming from Create Video flow
    setLoginModalOpen(true);
  };

  const handleShowGetStarted = () => {
    setLoginModalOpen(false);
    setBrandSignupModalOpen(false);
    setCreatorSignupModalOpen(false);
    setGetStartedModalOpen(true);
  };

  const closeAllModals = () => {
    setLoginModalOpen(false);
    setGetStartedModalOpen(false);
    setBrandSignupModalOpen(false);
    setCreatorSignupModalOpen(false);
  };

  const handleLogout = () => {
    logout();
    // Use replace to avoid BrandLayout intercepting and redirecting to login
    // If we're on a brand route, use window.location for a clean redirect
    if (pathname?.startsWith('/brand')) {
      window.location.href = '/';
    } else {
      router.replace('/');
    }
  };

  // Fetch user profile when authenticated (only if not already available from useAuth)
  useEffect(() => {
    if (isAuthenticated && !authUser) {
      apiClient.getProfile()
        .then((response) => {
          if (response.data) {
            setUser(response.data);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch user profile:', err);
        });
    } else if (!isAuthenticated) {
      setUser(null);
    } else if (authUser) {
      // If authUser is available, use it
      // Convert authUser to match User type (credits is required in User but optional in authUser)
      setUser({
        ...authUser,
        credits: authUser.credits ?? 0,
      } as User);
    }
  }, [isAuthenticated, authUser]);

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

  const isActive = (href: string) => pathname === href;

  const brandDesktopNavClass = (href: string) =>
    cn(
      'px-3 md:px-4 py-2 md:py-3 rounded-xl font-heading text-sm font-medium transition-colors whitespace-nowrap',
      isActive(href)
        ? 'text-[#E86412] bg-orange-50/90'
        : 'text-[#0F082B] hover:text-[#E86412] hover:bg-orange-50/50',
    );

  const defaultDesktopNavClass = (href: string) =>
    cn(
      'px-3 md:px-4 py-2 md:py-3 rounded-xl text-sm font-medium transition-colors whitespace-nowrap',
      isActive(href) ? 'text-[#E86512] bg-orange-50' : 'text-[#0F082B] hover:text-[#E86512] hover:bg-orange-50/50',
    );

  const positionClasses = {
    fixed: 'fixed top-0 left-0 right-0 z-50',
    sticky: 'sticky top-0 z-50',
    /** Above workspace fixed rails (z-40); dropdowns stay clickable */
    relative: 'relative z-[100]',
  };

  // Define navigation items based on user role
  const brandNavItems = [
    { href: '/brand/dashboard', label: 'Home' },
    { href: '/brand/campaigns', label: 'My Campaigns' },
    { href: '/brand/videos', label: 'My Videos' },
    { href: '/brand/wallet', label: 'My Wallet' },
  ];

  const publicNavItems = [
    { href: '/', label: 'Home' },
    { href: '/features', label: 'Features' },
    { href: '/use-cases', label: 'Use Cases' },
    { href: '/enterprise', label: 'Enterprise' },
    { href: '/pricing', label: 'Pricing' },
  ];

  /** Logged-in creators: primary destinations only (wallet balance is in the header). */
  const loggedInCreatorNavItems = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'My Projects' },
    { href: '/campaigns', label: 'Campaigns' },
    { href: '/earnings', label: 'Earnings' },
    { href: '/pricing', label: 'Pricing' },
  ];

  const navItems = userIsBrand
    ? brandNavItems
    : isAuthenticated
      ? loggedInCreatorNavItems
      : publicNavItems;
  
  // Get brand name or user name for display
  const displayName = userIsBrand 
    ? ((currentUser as any)?.brandName || currentUser?.name || 'Brand')
    : (currentUser?.name || 'User');

  return (
    <>
      <header className={cn(positionClasses[position], "w-full pt-[43px] pb-0")}>
      <div className="max-w-[1248px] mx-auto px-4 sm:px-6">
        <div
          className={cn(
            'shadow-header rounded-2xl px-4 py-3 sm:px-6 sm:py-4',
            floatingBarSurface === 'translucent'
              ? 'bg-white/80 backdrop-blur-sm ring-1 ring-[#F0E6DF]/90'
              : 'bg-white'
          )}
        >
          <div className="flex items-center justify-between">
            {/* Logo - Conditionally render based on role */}
            {userIsBrand ? (
              <Link href="/brand/dashboard" className="flex items-center gap-2 flex-shrink-0">
                {/* Logo Image */}
                <Image 
                  src="/assets/logo.svg" 
                  alt="UserGen.ai Logo" 
                  width={38} 
                  height={44}
                  className="w-[38px] h-[44px]"
                />
                {/* Text + Badge Column */}
                <div className="flex flex-col items-start gap-0">
                  <span className="font-heading text-2xl font-medium text-black leading-none">UserGen.ai</span>
                  {/* FOR BRANDS Badge below text - centered */}
                  <div className="flex justify-start">
                    <BrandLogo showBrandLabel={true} />
                  </div>
                </div>
              </Link>
            ) : (
              <Link href="/" className="flex items-center gap-2 min-w-0">
                <Image 
                  src="/assets/logo.svg" 
                  alt="UserGen.ai Logo" 
                  width={38} 
                  height={44}
                  className="w-[30px] h-[35px] sm:w-[38px] sm:h-[44px] flex-shrink-0"
                />
                <span className="font-heading text-lg sm:text-2xl font-medium text-black whitespace-nowrap">UserGen.ai</span>
              </Link>
            )}

            {/* Desktop Navigation - Conditionally render based on role */}
            <div className="hidden lg:flex items-center gap-2">
              <nav className="flex items-center gap-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={userIsBrand ? brandDesktopNavClass(item.href) : defaultDesktopNavClass(item.href)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-shrink-0">
              {isAuthenticated && <NotificationBell />}
              {isAuthenticated && !userIsBrand && (
                <CreditDisplay className="hidden sm:flex" showAddButton={false} />
              )}
              {isAuthenticated && userIsBrand && (
                <BrandBalanceDisplay className="hidden sm:flex" />
              )}
              {isAuthenticated ? (
                <Dropdown
                  trigger={
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-[26px] cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0">
                      <div className={cn(
                        "w-8 h-8 flex items-center justify-center rounded-full text-white font-heading font-medium text-sm flex-shrink-0",
                        userIsBrand 
                          ? "bg-gradient-to-b from-[#E86412] to-[#F12A4C]"
                          : "bg-white"
                      )}>
                        {userIsBrand ? (
                          displayName.charAt(0).toUpperCase()
                        ) : (
                          <Image src="/assets/u_user.svg" alt="User" width={24} height={24} />
                        )}
                      </div>
                      <span className="hidden sm:block text-sm font-heading font-medium text-[#9E9E9E] whitespace-nowrap">
                        {displayName}
                      </span>
                    </div>
                  }
                  align="right"
                >
                  {userIsBrand ? (
                    <>
                      <DropdownItem 
                        onClick={() => {
                          router.push('/brand/dashboard');
                        }}
                        icon={<Briefcase className="w-5 h-5" />}
                      >
                        Dashboard
                      </DropdownItem>
                      <DropdownItem 
                        onClick={() => {
                          router.push('/brand/campaigns');
                        }}
                        icon={<Megaphone className="w-5 h-5" />}
                      >
                        My Campaigns
                      </DropdownItem>
                      <DropdownItem 
                        onClick={() => {
                          router.push('/brand/videos');
                        }}
                        icon={<Video className="w-5 h-5" />}
                      >
                        My Videos
                      </DropdownItem>
                  <DropdownItem 
                    onClick={() => {
                      router.push('/brand/wallet');
                    }}
                    icon={<Wallet className="w-5 h-5" />}
                  >
                    My Wallet
                  </DropdownItem>
                  <DropdownItem
                    onClick={() => {
                      router.push('/billing');
                    }}
                    icon={<Receipt className="w-5 h-5" />}
                  >
                    Billing
                  </DropdownItem>
                  <DropdownItem onClick={handleLogout} icon={<LogOut className="w-5 h-5" />}>
                    Logout
                  </DropdownItem>
                    </>
                  ) : (
                    <>
                      <DropdownItem 
                        onClick={() => {
                          router.push('/billing');
                        }}
                        icon={<Receipt className="w-5 h-5" />}
                      >
                        Billing
                      </DropdownItem>
                      <DropdownItem
                        onClick={() => {
                          router.push('/usage');
                        }}
                        icon={<BarChart3 className="w-5 h-5" />}
                      >
                        Usage
                      </DropdownItem>
                      <DropdownItem onClick={handleLogout} icon={<LogOut className="w-5 h-5" />}>
                        Logout
                      </DropdownItem>
                    </>
                  )}
                </Dropdown>
              ) : (
                <>
                  <div 
                    onClick={() => {
                      // Clear any existing flag - this is from normal Login button
                      if (typeof window !== 'undefined') {
                        sessionStorage.removeItem('fromCreateVideo');
                      }
                      setLoginModalOpen(true);
                    }} 
                    className="hidden md:block cursor-pointer"
                  >
                    <Button variant="secondary" size="sm">Login</Button>
                  </div>
                  {!userIsBrand && (
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={handleCreateVideoClick}
                      className="whitespace-nowrap flex-shrink-0 text-sm sm:text-base max-sm:shadow-none"
                    >
                      <span className="sm:hidden">Create</span>
                      <span className="hidden sm:inline">Create a Video</span>
                    </Button>
                  )}
                </>
              )}
              
              {/* Mobile Menu Button */}
              <button
                className="lg:hidden p-2"
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

          {/* Mobile Menu - Conditionally render based on role */}
          {mobileMenuOpen && (
            <div className="lg:hidden mt-4 pt-4 border-t border-gray-200">
              <nav className="flex flex-col gap-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'px-4 py-3 rounded-2xl font-medium transition-colors',
                      userIsBrand
                        ? cn(
                            'font-heading text-sm',
                            isActive(item.href)
                              ? 'text-[#E86412] bg-orange-50/90'
                              : 'text-[#0F082B] active:bg-orange-50/50',
                          )
                        : cn(
                            'text-sm',
                            isActive(item.href) ? 'text-[#E86512] bg-orange-50' : 'text-[#0F082B]',
                          ),
                    )}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
                {!isAuthenticated && (
                  <div 
                    onClick={() => {
                      // Clear any existing flag - this is from normal Login button
                      if (typeof window !== 'undefined') {
                        sessionStorage.removeItem('fromCreateVideo');
                      }
                      setLoginModalOpen(true);
                      setMobileMenuOpen(false);
                    }}
                    className="px-4 py-3 cursor-pointer"
                  >
                    <Button variant="secondary" size="sm" fullWidth>Login</Button>
                  </div>
                )}
              </nav>
            </div>
          )}
        </div>
      </div>
    </header>
    
    {/* Modals */}
    <LoginModal 
      isOpen={loginModalOpen} 
      onClose={closeAllModals}
      onShowGetStarted={handleShowGetStarted}
      redirectUrl={pathname || '/'}
    />
    <GetStartedModal
      isOpen={getStartedModalOpen}
      onClose={closeAllModals}
      onSelectCreator={handleSelectCreator}
      onSelectBrand={handleSelectBrand}
      onShowLogin={handleShowLogin}
    />
    <CreatorSignupModal
      isOpen={creatorSignupModalOpen}
      onClose={closeAllModals}
      onShowLogin={handleShowLogin}
    />
    <BrandSignupModal
      isOpen={brandSignupModalOpen}
      onClose={closeAllModals}
      onShowLogin={handleShowLogin}
    />
    </>
  );
}


