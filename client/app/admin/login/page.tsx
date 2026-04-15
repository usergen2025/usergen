'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';

export default function AdminLoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, user, isLoading: authLoading } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated as admin
  useEffect(() => {
    if (!authLoading && isAuthenticated && user) {
      const userRole = user.role?.toUpperCase();
      if (userRole === 'ADMIN' || userRole === 'OWNER') {
        router.push('/admin');
      }
    }
  }, [isAuthenticated, user, authLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await apiClient.loginWithPassword(email, password);
      
      if (response.success && response.data) {
        const { user: userData, tokens } = response.data;
        
        // Check if user has admin role
        const userRole = userData.role?.toUpperCase();
        if (userRole !== 'ADMIN' && userRole !== 'OWNER') {
          setError('Access denied. Admin privileges required.');
          setIsLoading(false);
          return;
        }

        // Store tokens and user data
        localStorage.setItem('authToken', tokens.accessToken);
        localStorage.setItem('refreshToken', tokens.refreshToken);
        localStorage.setItem('user', JSON.stringify(userData));
        
        // Use the login function from useAuth to update state
        login(tokens.accessToken, userData);
        
        // Redirect to admin dashboard
        router.push('/admin');
      } else {
        setError(response.error || 'Login failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Admin login error:', err);
      if (err.response?.status === 401) {
        setError('Invalid email or password.');
      } else if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else {
        setError('An error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading while checking auth state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-[600px] h-[600px] -top-48 -left-48 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute w-[600px] h-[600px] -bottom-48 -right-48 bg-pink-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Login Card */}
        <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-8 border border-gray-700/50 shadow-2xl">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Image 
                src="/assets/logo.svg" 
                alt="UserGen.ai Logo" 
                width={40} 
                height={46}
                className="w-10 h-auto"
              />
              <span className="text-2xl font-semibold text-white">UserGen.ai</span>
            </div>
            <h1 className="text-xl font-medium text-gray-300">Admin Portal</h1>
            <p className="text-sm text-gray-500 mt-2">Sign in with your admin credentials</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-400 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@usergen.ai"
                required
                disabled={isLoading}
                className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all disabled:opacity-50"
              />
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-400 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={isLoading}
                  className="w-full px-4 py-3 pr-12 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition-all disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !email || !password}
              className="w-full py-3.5 px-6 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-medium rounded-xl hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in to Admin Portal'
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-gray-700/50 text-center">
            <p className="text-sm text-gray-500">
              Not an admin?{' '}
              <a href="/" className="text-orange-400 hover:text-orange-300 transition-colors">
                Go to main site
              </a>
            </p>
          </div>
        </div>

        {/* Security Note */}
        <p className="text-center text-xs text-gray-600 mt-6">
          This is a secure admin area. Unauthorized access is prohibited.
        </p>
      </div>
    </div>
  );
}
