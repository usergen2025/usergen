'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Search,
  Eye,
  Ban,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  X,
  UserCog,
  Coins,
  Video,
  ExternalLink,
  Percent,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';

interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
  credits: number;
  /** Auth DB mirror; may differ from `credits` when wallet is source of truth */
  profileCredits?: number;
  walletCredits?: number | null;
  isActive: boolean;
  isEmailVerified: boolean;
  createdAt: string;
  lastLoginAt?: string;
  profilePicture?: string;
}

function UsersLoadingSkeleton() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="mb-2 h-8 w-48 animate-pulse rounded bg-gray-700"></div>
        <div className="h-4 w-64 animate-pulse rounded bg-gray-700"></div>
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="animate-pulse border-b border-gray-700 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gray-700"></div>
              <div className="flex-1">
                <div className="mb-2 h-4 w-32 rounded bg-gray-700"></div>
                <div className="h-3 w-48 rounded bg-gray-700"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminUsersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user: adminUser } = useAuth();
  const filterUserId = searchParams?.get('userId') ?? '';

  const [users, setUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [actionUser, setActionUser] = useState<UserData | null>(null);
  const [newRole, setNewRole] = useState('');
  const [creditsAmount, setCreditsAmount] = useState(0);
  const [addToExisting, setAddToExisting] = useState(true);
  const [feePercent, setFeePercent] = useState('');
  const [feeTaxExempt, setFeeTaxExempt] = useState(false);
  const [feeNotes, setFeeNotes] = useState('');
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeSaving, setFeeSaving] = useState(false);
  const { showToast } = useToast();

  const usersPerPage = 20;

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.getAdminUsers({
        page: currentPage,
        limit: usersPerPage,
        search: searchQuery || undefined,
        role: selectedRole !== 'all' ? selectedRole : undefined,
        userId: filterUserId || undefined,
      });

      if (response.success && response.data) {
        setUsers(response.data.users);
        setTotalPages(response.data.pagination.totalPages);
        setTotalUsers(response.data.pagination.total);
      }
    } catch (error: any) {
      console.error('Failed to fetch users:', error);
      showToast(error.message || 'Failed to fetch users', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, searchQuery, selectedRole, filterUserId, showToast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedRole, filterUserId]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'OWNER':
        return 'bg-red-500/20 text-red-400';
      case 'ADMIN':
        return 'bg-orange-500/20 text-orange-400';
      case 'BRAND':
        return 'bg-purple-500/20 text-purple-400';
      case 'AVATAR_CREATOR':
        return 'bg-blue-500/20 text-blue-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const handleViewUser = async (user: UserData) => {
    try {
      const response = await apiClient.getAdminUserById(user.id);
      if (response.success && response.data) {
        setSelectedUser(response.data);
        setShowUserModal(true);
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to fetch user details', 'error');
    }
  };

  const handleRoleChange = async () => {
    if (!actionUser || !newRole) return;
    try {
      const response = await apiClient.updateUserRole(actionUser.id, newRole);
      if (response.success) {
        showToast('User role updated successfully', 'success');
        setShowRoleModal(false);
        setActionUser(null);
        setNewRole('');
        fetchUsers();
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to update role', 'error');
    }
  };

  const handleCreditsUpdate = async () => {
    if (!actionUser) return;
    try {
      const response = await apiClient.updateUserCredits(actionUser.id, creditsAmount, addToExisting);
      if (response.success) {
        showToast('Credits updated successfully', 'success');
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('credits-refresh'));
        }
        setShowCreditsModal(false);
        setActionUser(null);
        setCreditsAmount(0);
        fetchUsers();
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to update credits', 'error');
    }
  };

  const openFeeModal = async (user: UserData) => {
    setActionUser(user);
    setShowFeeModal(true);
    setFeeLoading(true);
    setFeePercent('');
    setFeeTaxExempt(false);
    setFeeNotes('');
    try {
      const res = await apiClient.getAdminUserBillingOverride(user.id);
      if (res.success && res.data) {
        setFeePercent(
          res.data.feeBps != null ? String((res.data.feeBps / 100).toFixed(2)) : '',
        );
        setFeeTaxExempt(!!res.data.taxExempt);
        setFeeNotes(res.data.notes || '');
      }
    } catch {
      /* no override yet */
    } finally {
      setFeeLoading(false);
    }
  };

  const handleFeeOverrideSave = async () => {
    if (!actionUser) return;
    setFeeSaving(true);
    try {
      const feeBps =
        feePercent.trim() === '' ? null : Math.round(Number(feePercent) * 100);
      if (feeBps != null && (Number.isNaN(feeBps) || feeBps < 0)) {
        showToast('Enter a valid fee percent', 'error');
        return;
      }
      const res = await apiClient.upsertAdminUserBillingOverride(actionUser.id, {
        feeBps,
        feeType: feeBps != null ? 'PERCENT' : null,
        taxExempt: feeTaxExempt,
        notes: feeNotes.trim() || null,
        updatedBy: adminUser?.id,
      });
      if (res.success) {
        showToast('Billing override saved', 'success');
        setShowFeeModal(false);
        setActionUser(null);
      } else {
        showToast(res.error || 'Failed to save override', 'error');
      }
    } catch (error: any) {
      showToast(error?.response?.data?.message || error.message || 'Failed to save override', 'error');
    } finally {
      setFeeSaving(false);
    }
  };

  const handleFeeOverrideClear = async () => {
    if (!actionUser) return;
    setFeeSaving(true);
    try {
      const res = await apiClient.deleteAdminUserBillingOverride(actionUser.id);
      if (res.success) {
        showToast('Billing override cleared', 'success');
        setShowFeeModal(false);
        setActionUser(null);
      } else {
        showToast(res.error || 'Failed to clear override', 'error');
      }
    } catch (error: any) {
      showToast(error?.response?.data?.message || error.message || 'Failed to clear override', 'error');
    } finally {
      setFeeSaving(false);
    }
  };

  const handleToggleActive = async (user: UserData) => {
    try {
      const response = user.isActive 
        ? await apiClient.deactivateUser(user.id)
        : await apiClient.reactivateUser(user.id);
      
      if (response.success) {
        showToast(`User ${user.isActive ? 'deactivated' : 'reactivated'} successfully`, 'success');
        fetchUsers();
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to update user status', 'error');
    }
  };

  if (isLoading && users.length === 0) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <div className="h-8 w-48 bg-gray-700 rounded animate-pulse mb-2"></div>
          <div className="h-4 w-64 bg-gray-700 rounded animate-pulse"></div>
        </div>
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-6 py-4 border-b border-gray-700 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-700"></div>
                <div className="flex-1">
                  <div className="h-4 w-32 bg-gray-700 rounded mb-2"></div>
                  <div className="h-3 w-48 bg-gray-700 rounded"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">User Management</h1>
        <p className="text-gray-400">View and manage all platform users ({totalUsers} total)</p>
      </div>

      {filterUserId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
          <p className="text-sm text-gray-300">
            Showing user{' '}
            <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-orange-300">{filterUserId}</code>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/admin/generations?userId=${encodeURIComponent(filterUserId)}`}
              className="inline-flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300"
            >
              View generations
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => router.push('/admin/users')}
              className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
            >
              Clear filter
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            placeholder="Search users by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
        </div>
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500"
        >
          <option value="all">All Roles</option>
          <option value="USER">Users</option>
          <option value="BRAND">Brands</option>
          <option value="AVATAR_CREATOR">Avatar Creators</option>
          <option value="ADMIN">Admins</option>
          <option value="OWNER">Owners</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">User</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Role</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Credits</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Joined</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Last Login</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Status</th>
                <th className="px-6 py-4 text-right text-sm font-medium text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-700/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-white font-bold">
                        {user.name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-white font-medium">{user.name || 'No Name'}</p>
                        <p className="text-sm text-gray-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-xs font-medium",
                      getRoleBadgeColor(user.role)
                    )}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <span className="text-white">₹{user.credits.toLocaleString('en-IN')}</span>
                      {user.walletCredits === null && (
                        <span className="ml-1 text-xs text-amber-300" title="Payment service unreachable; showing profile credits">
                          (est.)
                        </span>
                      )}
                      {user.profileCredits !== undefined &&
                        user.walletCredits !== null &&
                        user.profileCredits !== user.credits && (
                          <span className="block text-xs text-gray-500">Auth: ₹{user.profileCredits.toLocaleString('en-IN')}</span>
                        )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-gray-400">{formatDate(user.createdAt)}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-gray-400">{formatDate(user.lastLoginAt)}</span>
                  </td>
                  <td className="px-6 py-4">
                    {user.isActive ? (
                      <span className="flex items-center gap-1 text-green-400 text-sm">
                        <CheckCircle className="w-4 h-4" />
                        Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400 text-sm">
                        <Ban className="w-4 h-4" />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/generations?userId=${encodeURIComponent(user.id)}`}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
                        title="View generations"
                      >
                        <Video className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => handleViewUser(user)}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setActionUser(user);
                          setNewRole(user.role);
                          setShowRoleModal(true);
                        }}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        title="Change Role"
                      >
                        <UserCog className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setActionUser(user);
                          setCreditsAmount(0);
                          setAddToExisting(true);
                          setShowCreditsModal(true);
                        }}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        title="Manage Credits"
                      >
                        <Coins className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openFeeModal(user)}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        title="Fee override"
                      >
                        <Percent className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(user)}
                        className={cn(
                          "p-2 rounded-lg transition-colors",
                          user.isActive 
                            ? "text-red-400 hover:text-red-300 hover:bg-red-500/20" 
                            : "text-green-400 hover:text-green-300 hover:bg-green-500/20"
                        )}
                        title={user.isActive ? "Deactivate" : "Reactivate"}
                      >
                        {user.isActive ? <Ban className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
          <p className="text-sm text-gray-400">
            Showing {(currentPage - 1) * usersPerPage + 1} to {Math.min(currentPage * usersPerPage, totalUsers)} of {totalUsers} users
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-gray-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* User Details Modal */}
      {showUserModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">User Details</h3>
              <button onClick={() => setShowUserModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-white text-2xl font-bold">
                  {selectedUser.name?.charAt(0) || selectedUser.email.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h4 className="text-xl font-semibold text-white">{selectedUser.name || 'No Name'}</h4>
                  <p className="text-gray-400">{selectedUser.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400">Role</label>
                  <p className="text-white">{selectedUser.role}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Credits (payment wallet)</label>
                  <p className="text-white">₹{selectedUser.credits.toLocaleString('en-IN')}</p>
                  {selectedUser.profileCredits !== undefined &&
                    selectedUser.walletCredits !== null &&
                    selectedUser.profileCredits !== selectedUser.credits && (
                      <p className="text-xs text-gray-500 mt-1">
                        Auth profile record: ₹{selectedUser.profileCredits.toLocaleString('en-IN')}
                      </p>
                    )}
                </div>
                <div>
                  <label className="text-sm text-gray-400">Status</label>
                  <p className={selectedUser.isActive ? 'text-green-400' : 'text-red-400'}>
                    {selectedUser.isActive ? 'Active' : 'Inactive'}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Email Verified</label>
                  <p className={selectedUser.isEmailVerified ? 'text-green-400' : 'text-yellow-400'}>
                    {selectedUser.isEmailVerified ? 'Yes' : 'No'}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Joined</label>
                  <p className="text-white">{formatDate(selectedUser.createdAt)}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Last Login</label>
                  <p className="text-white">{formatDate(selectedUser.lastLoginAt)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Change Role Modal */}
      {showRoleModal && actionUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl max-w-md w-full">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Change User Role</h3>
              <button onClick={() => setShowRoleModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-400 mb-4">
                Changing role for <span className="text-white font-medium">{actionUser.email}</span>
              </p>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white mb-4"
              >
                <option value="USER">User</option>
                <option value="BRAND">Brand</option>
                <option value="AVATAR_CREATOR">Avatar Creator</option>
                <option value="ADMIN">Admin</option>
                <option value="OWNER">Owner</option>
              </select>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRoleModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRoleChange}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  Update Role
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Credits Modal */}
      {showCreditsModal && actionUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl max-w-md w-full">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Manage Credits</h3>
              <button onClick={() => setShowCreditsModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-400 mb-2">
                Managing credits for <span className="text-white font-medium">{actionUser.email}</span>
              </p>
              <p className="text-gray-400 mb-4">
                Current balance: <span className="text-white font-medium">₹{actionUser.credits}</span>
              </p>
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">Credits Amount</label>
                <input
                  type="number"
                  value={creditsAmount}
                  onChange={(e) => setCreditsAmount(parseInt(e.target.value) || 0)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
                />
              </div>
              <label className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  checked={addToExisting}
                  onChange={(e) => setAddToExisting(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-gray-400">Add to existing balance</span>
              </label>
              <p className="text-sm text-gray-500 mb-4">
                New balance will be: ₹{addToExisting ? actionUser.credits + creditsAmount : creditsAmount}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCreditsModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreditsUpdate}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  Update Credits
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fee override modal */}
      {showFeeModal && actionUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl max-w-md w-full">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Fee override</h3>
              <button onClick={() => setShowFeeModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-400 mb-4">
                Per-user fee for <span className="text-white font-medium">{actionUser.email}</span>
              </p>
              {feeLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : (
                <>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-400 mb-2">
                      Platform fee % (leave blank to use default)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={feePercent}
                      onChange={(e) => setFeePercent(e.target.value)}
                      placeholder="e.g. 3"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <label className="flex items-center gap-2 mb-4">
                    <input
                      type="checkbox"
                      checked={feeTaxExempt}
                      onChange={(e) => setFeeTaxExempt(e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-gray-400">Tax exempt (no GST)</span>
                  </label>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-400 mb-2">Notes</label>
                    <textarea
                      rows={2}
                      value={feeNotes}
                      onChange={(e) => setFeeNotes(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleFeeOverrideClear}
                      disabled={feeSaving}
                      className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50"
                    >
                      Clear
                    </button>
                    <button
                      onClick={handleFeeOverrideSave}
                      disabled={feeSaving}
                      className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<UsersLoadingSkeleton />}>
      <AdminUsersContent />
    </Suspense>
  );
}
