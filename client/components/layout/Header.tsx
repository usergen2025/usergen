'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu, X, FolderKanban, Wallet } from 'lucide-react';
import Image from 'next/image';
import Button from '@/components/ui/Button';
import Dropdown, { DropdownItem } from '@/components/ui/Dropdown';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';
import LoginModal from '@/components/auth/LoginModal';
import GetStartedModal from '@/components/auth/GetStartedModal';
import BrandSignupModal from '@/components/auth/BrandSignupModal';
import CreatorSignupModal from '@/components/auth/CreatorSignupModal';
import { apiClient, User } from '@/lib/api/client';

interface HeaderProps {
  position?: 'fixed' | 'relative' | 'sticky';
}

export default function Header({ position = 'fixed' }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, isAuthenticated } = useAuth();
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [getStartedModalOpen, setGetStartedModalOpen] = useState(false);
  const [brandSignupModalOpen, setBrandSignupModalOpen] = useState(false);
  const [creatorSignupModalOpen, setCreatorSignupModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const handleCreateVideoClick = () => {
    if (isAuthenticated) {
      router.push('/create-video/ai-chat');
    } else {
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
    router.push('/');
  };

  // Fetch user profile when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      apiClient.getProfile()
        .then((response) => {
          if (response.data) {
            setUser(response.data);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch user profile:', err);
        });
    } else {
      setUser(null);
    }
  }, [isAuthenticated]);

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

  return (
    <>
      <header className={cn(positionClasses[position], "w-full pt-[43px] pb-0")}>
      <div className="max-w-[1248px] mx-auto px-6">
        <div className="bg-white shadow-header rounded-2xl px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
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

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-2">
              <nav className="flex items-center gap-2">
                <Link 
                  href="/" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    isActive('/') ? "text-[#E86512]" : "text-[#0F082B] hover:text-[#E86512]"
                  )}
                >
                  Home
                </Link>
                <Link 
                  href="/features" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    isActive('/features') ? "text-[#E86512]" : "text-[#0F082B] hover:text-[#E86512]"
                  )}
                >
                  Features
                </Link>
                <Link 
                  href="/use-cases" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    isActive('/use-cases') ? "text-[#E86512]" : "text-[#0F082B] hover:text-[#E86512]"
                  )}
                >
                  Use Cases
                </Link>
                <Link 
                  href="/enterprise" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    isActive('/enterprise') ? "text-[#E86512]" : "text-[#222222] hover:text-[#E86512]"
                  )}
                >
                  Enterprise
                </Link>
                <Link 
                  href="/pricing" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    isActive('/pricing') ? "text-[#E86512]" : "text-[#222222] hover:text-[#E86512]"
                  )}
                >
                  Pricing
                </Link>
              </nav>
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-2">
              {isAuthenticated ? (
                <Dropdown
                  trigger={
                    <div className="flex items-center gap-2 px-0 py-0 rounded-[26px] cursor-pointer hover:opacity-80 transition-opacity">
                      <div className="w-6 h-6 flex items-center justify-center bg-white rounded-[18px]">
                        <Image src="/assets/u_user.svg" alt="User" width={24} height={24} />
                      </div>
                      <span className="text-sm font-heading font-medium text-[#9E9E9E]">
                        {user?.name || 'User'}
                      </span>
                    </div>
                  }
                  align="right"
                >
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
                </Dropdown>
              ) : (
                <>
                  <div 
                    onClick={() => setLoginModalOpen(true)} 
                    className="hidden md:block cursor-pointer"
                  >
                    <Button variant="secondary" size="sm">Login</Button>
                  </div>
                  <Button 
                    variant="primary" 
                    size="sm"
                    onClick={handleCreateVideoClick}
                  >
                    Create a Video
                  </Button>
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

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="lg:hidden mt-4 pt-4 border-t border-gray-200">
              <nav className="flex flex-col gap-2">
                <Link 
                  href="/" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium",
                    isActive('/') ? "text-[#E86512]" : "text-[#0F082B]"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Home
                </Link>
                <Link 
                  href="/features" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium",
                    isActive('/features') ? "text-[#E86512]" : "text-[#0F082B]"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Features
                </Link>
                <Link 
                  href="/use-cases" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium",
                    isActive('/use-cases') ? "text-[#E86512]" : "text-[#0F082B]"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Use Cases
                </Link>
                <Link 
                  href="/enterprise" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium",
                    isActive('/enterprise') ? "text-[#E86512]" : "text-[#222222]"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Enterprise
                </Link>
                <Link 
                  href="/pricing" 
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium",
                    isActive('/pricing') ? "text-[#E86512]" : "text-[#222222]"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Pricing
                </Link>
                {!isAuthenticated && (
                  <div 
                    onClick={() => {
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


