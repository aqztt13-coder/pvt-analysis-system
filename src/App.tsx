import React, { useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { AuthScreen } from './components/AuthScreen';
import { AdminSystemView } from './components/modules/AdminSystemView';
import { AttendanceLeaveView } from './components/modules/AttendanceLeaveView';
import { CorrespondenceView } from './components/modules/CorrespondenceView';
import { DashboardView } from './components/modules/DashboardView';
import { DocumentsView } from './components/modules/DocumentsView';
import { EquipmentView } from './components/modules/EquipmentView';
import { EmployeesView } from './components/modules/EmployeesView';
import { InventoryView } from './components/modules/InventoryView';
import { MaintenanceCalView } from './components/modules/MaintenanceCalView';
import { MeetingsTasksView } from './components/modules/MeetingsTasksView';
import { NotificationsView } from './components/modules/NotificationsView';
import { ReportsCenterView } from './components/modules/ReportsCenterView';
import { RequestsView } from './components/modules/RequestsView';
import { SafetyView, TrainingView } from './components/modules/TrainingSafetyView';
import { apiRequest, setAuthToken } from './lib/api';
import type { AuthUser, ModuleKey, SystemSettings } from './shared/types';

interface SetupStatus {
  needsSetup: boolean;
  companyNameAr: string;
  divisionNameAr: string;
  divisionNameEn: string;
}

const DEFAULT_CLIENT_SETTINGS: SystemSettings = {
  companyNameAr: 'شركة نفط الجنوب — هيئة المختبرات والبحوث',
  companyNameEn: 'South Oil Company — Laboratories & Research Directorate',
  divisionNameAr: 'شعبة موائع المكامن (مختبر PVT)',
  divisionNameEn: 'PVT Reservoir Fluids Division',
  reportFooterAr: 'وثيقة إدارية داخلية — شعبة موائع المكامن (PVT)',
  serverHost: '0.0.0.0',
  serverPort: '3000',
  backupRetentionCount: 14,
  autoBackupEnabled: true,
  calibrationAlertDays: 30,
  warrantyAlertDays: 60,
  documentCategories: [],
  equipmentCategories: [],
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [setupStatus, setSetupStatus] = useState<SetupStatus>({
    needsSetup: false,
    companyNameAr: DEFAULT_CLIENT_SETTINGS.companyNameAr,
    divisionNameAr: DEFAULT_CLIENT_SETTINGS.divisionNameAr,
    divisionNameEn: DEFAULT_CLIENT_SETTINGS.divisionNameEn,
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_CLIENT_SETTINGS);
  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const showToast = useCallback((text: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ text, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const loadSetupStatus = useCallback(() => {
    setBooting(true);
    apiRequest<SetupStatus>('/auth/setup-status')
      .then(setSetupStatus)
      .catch(() => {
        showToast('تعذر الاتصال بالخادم المركزي المحلي.', 'err');
      })
      .finally(() => setBooting(false));
  }, [showToast]);

  useEffect(() => {
    loadSetupStatus();
  }, [loadSetupStatus]);

  const refreshAuthedContext = useCallback(async () => {
    try {
      const [meRes, notifRes] = await Promise.all([
        apiRequest<{ user: AuthUser; settings: SystemSettings }>('/auth/me'),
        apiRequest<{ unreadCount: number }>('/notifications'),
      ]);
      setUser(meRes.user);
      setSettings(meRes.settings);
      setUnreadNotifications(notifRes.unreadCount);
    } catch {
      // session expired
      setAuthToken(null);
      setUser(null);
    }
  }, []);

  const handleAuthenticated = (authedUser: AuthUser) => {
    setUser(authedUser);
    setSetupStatus((prev) => ({ ...prev, needsSetup: false }));
    setActiveModule('dashboard');
    refreshAuthedContext();
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setActiveModule('dashboard');
    loadSetupStatus();
  };

  const handleSelectModule = (mod: ModuleKey) => {
    if (mod === 'admin' && user?.role !== 'manager') {
      showToast('وحدة إدارة النظام متاحة لمدير الشعبة فقط.', 'err');
      return;
    }
    setActiveModule(mod);
  };

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F6F9] dark:bg-[#101A24] text-[#102638] dark:text-[#E8EEF3]">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-[#078C8C] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium">جارٍ الاتصال بالخادم المركزي لشعبة موائع المكامن...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        needsSetup={setupStatus.needsSetup}
        companyNameAr={setupStatus.companyNameAr}
        divisionNameAr={setupStatus.divisionNameAr}
        divisionNameEn={setupStatus.divisionNameEn}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <>
      <AppShell
        user={user}
        settings={settings}
        activeModule={activeModule}
        onSelectModule={handleSelectModule}
        unreadNotifications={unreadNotifications}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        onLogout={handleLogout}
      >
        {activeModule === 'dashboard' && <DashboardView user={user} onNavigate={handleSelectModule} />}
        {activeModule === 'employees' && <EmployeesView user={user} onToast={showToast} />}
        {activeModule === 'attendance' && <AttendanceLeaveView user={user} onToast={showToast} />}
        {activeModule === 'equipment' && <EquipmentView user={user} settings={settings} onToast={showToast} />}
        {activeModule === 'maintenance' && <MaintenanceCalView user={user} onToast={showToast} />}
        {activeModule === 'documents' && <DocumentsView user={user} settings={settings} onToast={showToast} />}
        {activeModule === 'correspondence' && <CorrespondenceView user={user} onToast={showToast} />}
        {activeModule === 'inventory' && <InventoryView user={user} onToast={showToast} />}
        {activeModule === 'requests' && <RequestsView user={user} onToast={showToast} />}
        {activeModule === 'meetings' && <MeetingsTasksView user={user} onToast={showToast} />}
        {activeModule === 'training' && <TrainingView user={user} onToast={showToast} />}
        {activeModule === 'safety' && <SafetyView user={user} onToast={showToast} />}
        {activeModule === 'notifications' && (
          <NotificationsView
            onNavigate={handleSelectModule}
            onCountChanged={setUnreadNotifications}
            onToast={showToast}
          />
        )}
        {activeModule === 'reports' && <ReportsCenterView user={user} onToast={showToast} />}
        {activeModule === 'admin' && user.role === 'manager' && (
          <AdminSystemView
            currentUser={user}
            settings={settings}
            onSettingsUpdated={setSettings}
            onToast={showToast}
          />
        )}
      </AppShell>

      {/* Non-blocking Toast Banner */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 left-5 z-50 max-w-md px-4 py-3 rounded-lg shadow-lg border text-sm font-medium no-print ${
            toast.type === 'err'
              ? 'bg-red-700 text-white border-red-800'
              : 'bg-[#102638] text-white border-[#C99A45]/60'
          }`}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}
