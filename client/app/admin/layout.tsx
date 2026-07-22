'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { 
  LayoutDashboard, 
  Users, 
  Video, 
  DollarSign, 
  Shield, 
  Settings,
  RefreshCcw,
  Briefcase,
  LogOut,
  Menu,
  X,
  ChevronRight,
  CreditCard,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';

const adminNavItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/generations', label: 'Generations', icon: Video },
  { href: '/admin/pricing', label: 'Pricing', icon: DollarSign },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/iam', label: 'IAM', icon: Shield },
  { href: '/admin/campaign-sync', label: 'Campaign Sync', icon: RefreshCcw },
  { href: '/admin/campaigns', label: 'Campaigns', icon: Briefcase },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, user, logout, isLoading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Check if we're on the admin login page
  const isAdminLoginPage = pathname === '/admin/login';

  // Check if user is admin
  useEffect(() => {
    // Skip auth check for admin login page
    if (isAdminLoginPage) {
      setIsAuthorized(true);
      return;
    }

    if (!isLoading) {
      if (!isAuthenticated) {
        // Redirect to admin-specific login page
        router.push('/admin/login');
        return;
      }

      // Check if user has admin role
      const userRole = user?.role?.toUpperCase();
      const isAdmin = userRole === 'ADMIN' || userRole === 'OWNER';
      
      if (!isAdmin) {
        // Not authorized - redirect to home
        router.push('/');
        return;
      }

      setIsAuthorized(true);
    }
  }, [isAuthenticated, user, isLoading, router, pathname, isAdminLoginPage]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  // Show the admin login page without the sidebar layout
  if (isAdminLoginPage) {
    return <>{children}</>;
  }

  if (isLoading || !isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Verifying access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: fixed height = viewport; nav scrolls; profile stays at bottom */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-gray-800 flex flex-col h-screen min-h-0 transform transition-transform duration-200 lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-700">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-white">Admin Portal</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1">
          {adminNavItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/admin' && pathname?.startsWith(item.href));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                  isActive
                    ? "bg-orange-500/20 text-orange-400"
                    : "text-gray-400 hover:bg-gray-700 hover:text-white"
                )}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
                {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="flex-shrink-0 p-4 border-t border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-white font-bold">
              {user?.name?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium truncate">{user?.name || 'Admin'}</p>
              <p className="text-sm text-gray-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content — offset fixed sidebar on desktop */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 lg:pl-64">
        {/* Top bar */}
        <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-gray-400 hover:text-white"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bold text-white">Admin Portal</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
