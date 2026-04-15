'use client';

import { useState, useEffect } from 'react';
import { 
  Save,
  Globe,
  Bell,
  Shield,
  Database,
  AlertCircle,
  Info
} from 'lucide-react';
import { useToast } from '@/lib/toast/toast';

interface SystemSettings {
  siteName: string;
  supportEmail: string;
  defaultCredits: number;
  maxFileSizeMB: number;
  enableNotifications: boolean;
  enableAuditLogs: boolean;
  maintenanceMode: boolean;
}

const DEFAULT_SETTINGS: SystemSettings = {
  siteName: 'UserGen.ai',
  supportEmail: 'support@usergen.ai',
  defaultCredits: 100,
  maxFileSizeMB: 50,
  enableNotifications: true,
  enableAuditLogs: true,
  maintenanceMode: false,
};

const SETTINGS_KEY = 'admin_system_settings';

export default function AdminSettingsPage() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const loadSettings = () => {
      setIsLoading(true);
      try {
        const savedSettings = localStorage.getItem(SETTINGS_KEY);
        if (savedSettings) {
          setSettings(JSON.parse(savedSettings));
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSettingChange = (key: keyof SystemSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      showToast('Settings saved successfully!', 'success');
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save settings:', error);
      showToast('Failed to save settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl">
        <div className="mb-6">
          <div className="h-8 w-32 bg-gray-700 rounded animate-pulse mb-2"></div>
          <div className="h-4 w-48 bg-gray-700 rounded animate-pulse"></div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-800 rounded-xl border border-gray-700 p-6 mb-6 animate-pulse">
            <div className="h-6 w-32 bg-gray-700 rounded mb-4"></div>
            <div className="space-y-4">
              <div className="h-10 bg-gray-700 rounded"></div>
              <div className="h-10 bg-gray-700 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">Settings</h1>
        <p className="text-gray-400">Configure system-wide settings</p>
      </div>

      {/* Info Banner */}
      <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-blue-300 font-medium">Local Storage</p>
          <p className="text-blue-400/80 text-sm">
            Settings are currently stored in your browser. These settings will be persisted to the server when backend storage is implemented.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* General Settings */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-orange-500" />
            General
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Site Name</label>
              <input
                type="text"
                value={settings.siteName}
                onChange={(e) => handleSettingChange('siteName', e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Support Email</label>
              <input
                type="email"
                value={settings.supportEmail}
                onChange={(e) => handleSettingChange('supportEmail', e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </div>

        {/* Credits Settings */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-orange-500" />
            Credits & Limits
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Default Credits for New Users</label>
              <input
                type="number"
                value={settings.defaultCredits}
                onChange={(e) => handleSettingChange('defaultCredits', parseInt(e.target.value) || 0)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500"
                min="0"
              />
              <p className="text-xs text-gray-500 mt-1">New users will receive this amount of credits upon registration.</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Max Upload File Size (MB)</label>
              <input
                type="number"
                value={settings.maxFileSizeMB}
                onChange={(e) => handleSettingChange('maxFileSizeMB', parseInt(e.target.value) || 0)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500"
                min="1"
              />
            </div>
          </div>
        </div>

        {/* Feature Flags */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-orange-500" />
            Features
          </h2>
          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-gray-300 block">Enable Email Notifications</span>
                <span className="text-xs text-gray-500">Send email notifications to users for important events</span>
              </div>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.enableNotifications}
                  onChange={(e) => handleSettingChange('enableNotifications', e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-11 h-6 rounded-full transition-colors ${settings.enableNotifications ? 'bg-orange-500' : 'bg-gray-600'}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${settings.enableNotifications ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </div>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-gray-300 block">Enable Audit Logs</span>
                <span className="text-xs text-gray-500">Track all admin actions for security and compliance</span>
              </div>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={settings.enableAuditLogs}
                  onChange={(e) => handleSettingChange('enableAuditLogs', e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-11 h-6 rounded-full transition-colors ${settings.enableAuditLogs ? 'bg-orange-500' : 'bg-gray-600'}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${settings.enableAuditLogs ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-gray-800 rounded-xl border border-red-500/30 p-6">
          <h2 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Danger Zone
          </h2>
          <label className="flex items-center justify-between cursor-pointer mb-4">
            <div>
              <span className="text-gray-300 block">Maintenance Mode</span>
              <span className="text-sm text-gray-500">Disable access for non-admin users. Use during deployments or emergencies.</span>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={settings.maintenanceMode}
                onChange={(e) => handleSettingChange('maintenanceMode', e.target.checked)}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${settings.maintenanceMode ? 'bg-red-500' : 'bg-gray-600'}`}>
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${settings.maintenanceMode ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
              </div>
            </div>
          </label>
          <button
            onClick={handleReset}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            Reset to defaults
          </button>
        </div>

        {/* Save Button */}
        <div className="flex gap-4">
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-5 h-5" />
            )}
            <span>{hasChanges ? 'Save Settings' : 'No Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
