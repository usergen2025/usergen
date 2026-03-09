'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu, X, FolderKanban, Wallet, Briefcase, Video, Megaphone } from 'lucide-react';
import Image from 'next/image';
import Button from '@/components/ui/Button';
import Dropdown, { DropdownItem } from '@/components/ui/Dropdown';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';
import LoginModal from '@/components/auth/LoginModal';
import GetStartedModal from '@/components/auth/GetStartedModal';
import BrandSignupModal from '@/components/auth/BrandSignupModal';
import CreatorSignupModal from '@/components/auth/CreatorSignupModal';
import BrandLogo from '@/components/layout/BrandLogo';
import { apiClient, User } from '@/lib/api/client';

interface HeaderProps {
  position?: 'fixed' | 'relative' | 'sticky';
}

export default function Header({ position = 'fixed' }: HeaderProps) {
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

  const positionClasses = {
    fixed: 'fixed top-0 left-0 right-0 z-50',
    sticky: 'sticky top-0 z-50',
    relative: 'relative'
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

  const navItems = userIsBrand ? brandNavItems : publicNavItems;
  
  // Get brand name or user name for display
  const displayName = userIsBrand 
    ? ((currentUser as any)?.brandName || currentUser?.name || 'Brand')
    : (currentUser?.name || 'User');

  return (
    <>
      <header className={cn(positionClasses[position], "w-full pt-[43px] pb-0")}>
      <div className="max-w-[1248px] mx-auto px-6">
        <div className="bg-white shadow-header rounded-2xl px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo - Conditionally render based on role */}
            {userIsBrand ? (
              <Link href="/brand/dashboard" className="flex items-start gap-2 flex-shrink-0">
                {/* Logo Image */}
                <Image 
                  src="/assets/logo.svg" 
                  alt="UserGen.ai Logo" 
                  width={38} 
                  height={44}
                  className="w-[38px] h-[44px]"
                />
                {/* Text + Badge Column */}
                <div className="flex flex-col items-center gap-0">
                  <span className="font-heading text-2xl font-medium text-black">UserGen.ai</span>
                  {/* FOR BRANDS Badge below text - centered */}
                  <div className="flex justify-center">
                    <BrandLogo showBrandLabel={true} />
                  </div>
                </div>
              </Link>
            ) : (
              <Link href="/" className="flex items-center gap-2">
                <Image 
                  src="/assets/logo.svg" 
                  alt="UserGen.ai Logo" 
                  width={38} 
                  height={44}
                  className="w-[38px] h-[44px]"
                />
                <span className="font-heading text-2xl font-medium text-black">UserGen.ai</span>
              </Link>
            )}

            {/* Desktop Navigation - Conditionally render based on role */}
            <div className="hidden lg:flex items-center gap-2">
              <nav className="flex items-center gap-2">
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
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-2">
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
                      <DropdownItem onClick={handleLogout} icon={<LogOut className="w-5 h-5" />}>
                        Logout
                      </DropdownItem>
                    </>
                  ) : (
                    <>
                      <DropdownItem 
                        onClick={() => {
                          router.push('/projects');
                        }}
                        icon={<FolderKanban className="w-5 h-5" />}
                      >
                        My Projects
                      </DropdownItem>
                      <DropdownItem 
                        onClick={() => {
                          router.push('/wallet');
                        }}
                        icon={<Wallet className="w-5 h-5" />}
                      >
                        My Wallet
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
                    >
                      Create a Video
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


