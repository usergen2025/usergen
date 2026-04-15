'use client';

import { useState, useEffect } from 'react';
import { 
  Users, 
  Video, 
  DollarSign, 
  TrendingUp,
  Activity,
  Calendar
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';

interface DashboardStats {
  totalUsers: number;
  activeUsersToday: number;
  totalAdmins: number;
  newUsersToday: number;
  totalProjects: number;
  projectsToday: number;
  completedProjects: number;
  usersByRole: Record<string, number>;
}

interface ProjectStats {
  totalProjects: number;
  completedProjects: number;
  projectsToday: number;
  projectsThisMonth: number;
  statusBreakdown: Record<string, number>;
  videoTypeBreakdown: Record<string, number>;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    activeUsersToday: 0,
    totalAdmins: 0,
    newUsersToday: 0,
    totalProjects: 0,
    projectsToday: 0,
    completedProjects: 0,
    usersByRole: {},
  });
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [userStatsResponse, projectStatsResponse] = await Promise.all([
          apiClient.getAdminDashboardStats(),
          apiClient.getAdminProjectStats(),
        ]);

        if (userStatsResponse.success && userStatsResponse.data) {
          setStats({
            totalUsers: userStatsResponse.data.totalUsers || 0,
            activeUsersToday: userStatsResponse.data.activeUsersToday || 0,
            totalAdmins: userStatsResponse.data.totalAdmins || 0,
            newUsersToday: userStatsResponse.data.newUsersToday || 0,
            totalProjects: 0,
            projectsToday: 0,
            completedProjects: 0,
            usersByRole: userStatsResponse.data.usersByRole || {},
          });
        }

        if (projectStatsResponse.success && projectStatsResponse.data) {
          setProjectStats(projectStatsResponse.data);
        }
      } catch (err: any) {
        console.error('Failed to fetch admin stats:', err);
        setError(err.message || 'Failed to fetch dashboard data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, []);

  const statCards = [
    {
      title: 'Total Users',
      value: stats.totalUsers,
      subValue: `${stats.activeUsersToday} active today`,
      icon: Users,
      color: 'from-blue-500 to-blue-600',
    },
    {
      title: 'Total Generations',
      value: projectStats?.totalProjects || 0,
      subValue: `${projectStats?.projectsToday || 0} today`,
      icon: Video,
      color: 'from-purple-500 to-purple-600',
    },
    {
      title: 'Completed Videos',
      value: projectStats?.completedProjects || 0,
      subValue: `${projectStats?.projectsThisMonth || 0} this month`,
      icon: DollarSign,
      color: 'from-green-500 to-green-600',
    },
    {
      title: 'Admin Users',
      value: stats.totalAdmins,
      subValue: `${stats.newUsersToday} new users today`,
      icon: TrendingUp,
      color: 'from-orange-500 to-pink-500',
    },
  ];

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="mb-8">
          <div className="h-8 w-48 bg-gray-700 rounded animate-pulse mb-2"></div>
          <div className="h-4 w-64 bg-gray-700 rounded animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-gray-800 rounded-xl p-6 border border-gray-700 animate-pulse">
              <div className="w-12 h-12 rounded-xl bg-gray-700 mb-4"></div>
              <div className="h-4 w-24 bg-gray-700 rounded mb-2"></div>
              <div className="h-8 w-16 bg-gray-700 rounded mb-2"></div>
              <div className="h-3 w-20 bg-gray-700 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-6 text-center">
          <p className="text-red-400 mb-2">Failed to load dashboard</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">Overview of your platform's performance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <div
              key={index}
              className="bg-gray-800 rounded-xl p-6 border border-gray-700"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
              <p className="text-gray-400 text-sm mb-1">{card.title}</p>
              <p className="text-2xl font-bold text-white mb-1">{card.value}</p>
              <p className="text-sm text-gray-500">{card.subValue}</p>
            </div>
          );
        })}
      </div>

      {/* Status and Type Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-orange-500" />
              Project Status Breakdown
            </h2>
          </div>
          <div className="p-6 space-y-4">
            {projectStats?.statusBreakdown && Object.entries(projectStats.statusBreakdown).length > 0 ? (
              Object.entries(projectStats.statusBreakdown).map(([status, count]) => (
                <div key={status}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-400 capitalize">{status.toLowerCase().replace('_', ' ')}</span>
                    <span className="text-white font-medium">{count}</span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        status === 'COMPLETED' ? 'bg-green-500' :
                        status === 'DRAFT' ? 'bg-blue-500' :
                        status === 'IN_PROGRESS' ? 'bg-purple-500' :
                        status === 'FAILED' ? 'bg-red-500' :
                        'bg-orange-500'
                      }`}
                      style={{ width: `${Math.min((count / (projectStats?.totalProjects || 1)) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-center py-4">No project data available</p>
            )}
          </div>
        </div>

        {/* User Roles */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-orange-500" />
              Users by Role
            </h2>
          </div>
          <div className="p-6 space-y-4">
            {Object.entries(stats.usersByRole).length > 0 ? (
              Object.entries(stats.usersByRole).map(([role, count]) => (
                <div key={role}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-400 capitalize">{role.toLowerCase().replace('_', ' ')}</span>
                    <span className="text-white font-medium">{count}</span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        role === 'OWNER' ? 'bg-red-500' :
                        role === 'ADMIN' ? 'bg-orange-500' :
                        role === 'BRAND' ? 'bg-purple-500' :
                        role === 'AVATAR_CREATOR' ? 'bg-pink-500' :
                        'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min((count / stats.totalUsers) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-center py-4">No user data available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
