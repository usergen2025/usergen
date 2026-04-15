'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Shield, 
  Users, 
  ChevronDown,
  ChevronUp,
  Search,
  Edit,
  Trash2,
  Check,
  X,
  History,
  AlertCircle,
  UserPlus
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';

interface Role {
  id: string;
  name: string;
  displayName: string;
  description: string;
  context: string;
  permissions?: string[];
  rolePermissions?: { permission: { name: string } }[];
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  result: boolean;
  reason?: string;
  createdAt: string;
}

type TabType = 'roles' | 'admins' | 'audit';

export default function AdminIAMPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('roles');
  const [roles, setRoles] = useState<Role[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUser | null>(null);
  const [newAdmin, setNewAdmin] = useState({ email: '', password: '', name: '', role: 'ADMIN' as 'ADMIN' | 'OWNER' });

  const fetchRoles = useCallback(async () => {
    try {
      const response = await apiClient.getIamRoles();
      if (response.success && response.data) {
        setRoles(response.data);
      } else {
        setRoles([]);
      }
    } catch (error) {
      console.error('Failed to fetch roles:', error);
      setRoles([]);
      showToast('Could not load roles from IAM. Check that the IAM service is running and NEXT_PUBLIC_IAM_SERVICE_URL is correct.', 'error');
    }
  }, [showToast]);

  const fetchAdmins = useCallback(async () => {
    try {
      const response = await apiClient.getAdminUsersList();
      if (response.success && response.data) {
        setAdmins(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch admins:', error);
      setAdmins([]);
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const response = await apiClient.getAuditLogs({ limit: 50 });
      if (response.success && response.data) {
        setAuditLogs(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
      setAuditLogs([]);
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      await Promise.all([fetchRoles(), fetchAdmins(), fetchAuditLogs()]);
      setIsLoading(false);
    };

    fetchData();
  }, [fetchRoles, fetchAdmins, fetchAuditLogs]);

  const handleCreateAdmin = async () => {
    if (!newAdmin.email || !newAdmin.password || !newAdmin.name) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    try {
      const response = await apiClient.createAdminUser(newAdmin);
      if (response.success) {
        showToast('Admin created successfully', 'success');
        setShowCreateModal(false);
        setNewAdmin({ email: '', password: '', name: '', role: 'ADMIN' });
        fetchAdmins();
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to create admin', 'error');
    }
  };

  const handleEditRole = async () => {
    if (!selectedAdmin) return;

    try {
      const response = await apiClient.updateUserRole(selectedAdmin.id, selectedAdmin.role);
      if (response.success) {
        showToast('Admin role updated successfully', 'success');
        setShowEditModal(false);
        setSelectedAdmin(null);
        fetchAdmins();
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to update admin', 'error');
    }
  };

  const handleDeleteAdmin = async () => {
    if (!selectedAdmin) return;

    try {
      const response = await apiClient.deactivateUser(selectedAdmin.id);
      if (response.success) {
        showToast('Admin deactivated successfully', 'success');
        setShowDeleteModal(false);
        setSelectedAdmin(null);
        fetchAdmins();
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to deactivate admin', 'error');
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getRoleColor = (role: string) => {
    const roleLower = role.toLowerCase();
    if (roleLower.includes('owner')) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (roleLower.includes('admin')) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    if (roleLower.includes('support')) return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    if (roleLower.includes('billing')) return 'bg-green-500/20 text-green-400 border-green-500/30';
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  const filteredAdmins = admins.filter(admin => 
    admin.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    admin.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isOwner = user?.role === 'OWNER';

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <div className="h-8 w-48 bg-gray-700 rounded animate-pulse mb-2"></div>
          <div className="h-4 w-64 bg-gray-700 rounded animate-pulse"></div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-800 rounded-xl border border-gray-700 p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-gray-700"></div>
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
        <h1 className="text-2xl font-bold text-white mb-2">IAM Management</h1>
        <p className="text-gray-400">Manage roles, permissions, and access control</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-700 pb-4">
        <button
          onClick={() => setActiveTab('roles')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
            activeTab === 'roles' ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white hover:bg-gray-700"
          )}
        >
          <Shield className="w-4 h-4" />
          Roles
        </button>
        <button
          onClick={() => setActiveTab('admins')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
            activeTab === 'admins' ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white hover:bg-gray-700"
          )}
        >
          <Users className="w-4 h-4" />
          Admins
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
            activeTab === 'audit' ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white hover:bg-gray-700"
          )}
        >
          <History className="w-4 h-4" />
          Audit Log
        </button>
      </div>

      {/* Roles Tab */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-start gap-3 mb-6">
            <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 font-medium">System Roles</p>
              <p className="text-blue-400/80 text-sm">
                These are predefined system roles from the IAM service.
              </p>
            </div>
          </div>

          {roles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No roles found. IAM service may not be running.
            </div>
          ) : (
            roles.map((role) => {
              const permissions = role.permissions || 
                role.rolePermissions?.map(rp => rp.permission.name) || [];
              
              return (
                <div key={role.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                  <button
                    onClick={() => setExpandedRole(expandedRole === role.id ? null : role.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center",
                        getRoleColor(role.name)
                      )}>
                        <Shield className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <p className="text-white font-medium">{role.displayName}</p>
                        <p className="text-sm text-gray-400">{role.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-500">{permissions.length} permissions</span>
                      {expandedRole === role.id ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {expandedRole === role.id && (
                    <div className="px-4 pb-4 bg-gray-900/50">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 pt-4">
                        {permissions.map((perm) => (
                          <div
                            key={perm}
                            className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg border border-gray-700"
                          >
                            <Check className="w-4 h-4 text-green-400" />
                            <span className="text-sm text-gray-300">{perm}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Admins Tab */}
      {activeTab === 'admins' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type="text"
                placeholder="Search admins..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
              />
            </div>
            {isOwner && (
              <button 
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                Create Admin
              </button>
            )}
          </div>

          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {filteredAdmins.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No admin users found
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Admin</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Role</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Status</th>
                    <th className="px-6 py-4 text-left text-sm font-medium text-gray-400">Last Login</th>
                    {isOwner && <th className="px-6 py-4 text-right text-sm font-medium text-gray-400">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {filteredAdmins.map((admin) => (
                    <tr key={admin.id} className="hover:bg-gray-700/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-white font-bold">
                            {admin.name?.charAt(0) || admin.email.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-white font-medium">{admin.name || 'No Name'}</p>
                            <p className="text-sm text-gray-400">{admin.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-xs font-medium border",
                          getRoleColor(admin.role)
                        )}>
                          {admin.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {admin.isActive ? (
                          <span className="text-green-400 text-sm">Active</span>
                        ) : (
                          <span className="text-red-400 text-sm">Inactive</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-gray-300 text-sm">{formatDate(admin.lastLoginAt)}</p>
                      </td>
                      {isOwner && (
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => {
                                setSelectedAdmin(admin);
                                setShowEditModal(true);
                              }}
                              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => {
                                setSelectedAdmin(admin);
                                setShowDeleteModal(true);
                              }}
                              className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-lg transition-colors"
                              disabled={admin.id === user?.id}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Audit Log Tab */}
      {activeTab === 'audit' && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No audit logs available. IAM service may not be running.
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      log.result ? "bg-green-500/20" : "bg-red-500/20"
                    )}>
                      {log.result ? (
                        <Check className="w-5 h-5 text-green-400" />
                      ) : (
                        <X className="w-5 h-5 text-red-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-white">
                        <span className="font-medium">User {log.userId}</span>
                        <span className="text-gray-400"> {log.action?.replace(/_/g, ' ')} </span>
                        <span className="text-gray-300">
                          {[log.resourceType, log.resourceId].filter(Boolean).join('/') || '—'}
                        </span>
                      </p>
                      {log.reason && (
                        <p className="text-sm text-red-400">{log.reason}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-sm text-gray-500">{formatDate(log.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Admin Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl max-w-md w-full">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Create Admin User</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Email</label>
                <input
                  type="email"
                  value={newAdmin.email}
                  onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
                  placeholder="admin@example.com"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Name</label>
                <input
                  type="text"
                  value={newAdmin.name}
                  onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
                  placeholder="Admin Name"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Password</label>
                <input
                  type="password"
                  value={newAdmin.password}
                  onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
                  placeholder="Min 8 characters"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Role</label>
                <select
                  value={newAdmin.role}
                  onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value as 'ADMIN' | 'OWNER' })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="OWNER">Owner</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateAdmin}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  Create Admin
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Admin Modal */}
      {showEditModal && selectedAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl max-w-md w-full">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Edit Admin Role</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-400 mb-4">
                Editing role for <span className="text-white font-medium">{selectedAdmin.email}</span>
              </p>
              <div className="mb-6">
                <label className="block text-sm text-gray-400 mb-2">Role</label>
                <select
                  value={selectedAdmin.role}
                  onChange={(e) => setSelectedAdmin({ ...selectedAdmin, role: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="OWNER">Owner</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditRole}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl max-w-md w-full">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white">Deactivate Admin</h3>
            </div>
            <div className="p-6">
              <p className="text-gray-400 mb-6">
                Are you sure you want to deactivate <span className="text-white font-medium">{selectedAdmin.email}</span>?
                They will no longer be able to access the admin portal.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAdmin}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  Deactivate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
