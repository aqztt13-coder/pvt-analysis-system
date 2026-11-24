import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Briefcase,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileArchive,
  FileBarChart2,
  GraduationCap,
  HardHat,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Moon,
  Package,
  Search,
  Settings,
  Sun,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  type AuthUser,
  type GlobalSearchResult,
  type ModuleKey,
  ROLE_LABELS,
  type SystemSettings,
} from '../shared/types';
import { Modal } from './Modal';

export interface NavItemDef {
  key: ModuleKey;
  label: string;
  section: string;
  Icon: React.ComponentType<{ className?: string }>;
  managerOnly?: boolean;
}

function getArabicInitials(fullName: string): string {
  const cleaned = fullName
    .trim()
    .replace(/^(?:م\.|أ\.|د\.|ف\.|المهندس|الدكتور|الأستاذ)\s+/u, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]} ${parts[parts.length - 1][0]}`;
  }
  return (cleaned || fullName).slice(0, 2);
}

export const NAV_ITEMS: NavItemDef[] = [
  { key: 'dashboard', label: 'لوحة القيادة الرئيسية', section: 'نظرة عامة', Icon: LayoutDashboard },
  { key: 'employees', label: 'إدارة الموظفين', section: 'الموارد البشرية', Icon: Users },
  { key: 'attendance', label: 'الحضور والإجازات', section: 'الموارد البشرية', Icon: CalendarClock },
  { key: 'training', label: 'التدريب والتطوير', section: 'الموارد البشرية', Icon: GraduationCap },
  { key: 'equipment', label: 'سجل المعدات والأصول', section: 'العمليات والأصول', Icon: Briefcase },
  { key: 'maintenance', label: 'الصيانة والمعايرة', section: 'العمليات والأصول', Icon: Wrench },
  { key: 'inventory', label: 'المخزون والمستهلكات', section: 'العمليات والأصول', Icon: Package },
  { key: 'documents', label: 'أرشيف التقارير والوثائق', section: 'التوثيق والإدارة', Icon: FileArchive },
  { key: 'correspondence', label: 'إدارة المراسلات', section: 'التوثيق والإدارة', Icon: Mail },
  { key: 'requests', label: 'الطلبات والمشتريات', section: 'التوثيق والإدارة', Icon: ClipboardCheck },
  { key: 'meetings', label: 'الاجتماعات والمهام', section: 'التوثيق والإدارة', Icon: CalendarDays },
  { key: 'safety', label: 'السلامة والفحص (HSE)', section: 'التوثيق والإدارة', Icon: HardHat },
  { key: 'notifications', label: 'مركز التنبيهات', section: 'المتابعة والتقارير', Icon: Bell },
  { key: 'reports', label: 'التقارير والتصدير', section: 'المتابعة والتقارير', Icon: FileBarChart2 },
  { key: 'admin', label: 'إدارة النظام والنسخ', section: 'الإدارة والأمان', Icon: Settings, managerOnly: true },
];

interface AppShellProps {
  user: AuthUser;
  settings: SystemSettings;
  activeModule: ModuleKey;
  onSelectModule: (m: ModuleKey) => void;
  unreadNotifications: number;
  darkMode: boolean;
  onToggleDark: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export function AppShell({
  user,
  settings,
  activeModule,
  onSelectModule,
  unreadNotifications,
  darkMode,
  onToggleDark,
  onLogout,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwdFeedback, setPwdFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const visibleNav = NAV_ITEMS.filter((item) => !item.managerOnly || user.role === 'manager');
  const currentNav = visibleNav.find((i) => i.key === activeModule) || visibleNav[0];

  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      apiRequest<{ results: GlobalSearchResult[] }>(`/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          setSearchResults(res.results);
          setSearchOpen(true);
        })
        .catch(() => setSearchResults([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdFeedback(null);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setPwdFeedback({ type: 'ok', text: 'تم تحديث كلمة المرور بنجاح.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPwdFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تحديث كلمة المرور.',
      });
    }
  };

  const renderNavLinks = (isMobile: boolean) => {
    const sections = Array.from(new Set(visibleNav.map((i) => i.section)));
    return (
      <nav
        aria-label="القائمة الرئيسية"
        className={`flex-1 overflow-y-auto px-2.5 ${isMobile ? 'py-3 space-y-4' : 'py-2 space-y-2.5'}`}
      >
        {sections.map((section) => (
          <div key={section}>
            {(!collapsed || isMobile) && (
              <p className={`px-3 text-[11px] font-semibold text-[#66869A] tracking-wide ${isMobile ? 'mb-1.5' : 'mb-1'}`}>
                {section}
              </p>
            )}
            <ul className="space-y-0.5">
              {visibleNav
                .filter((item) => item.section === section)
                .map((item) => {
                  const active = item.key === activeModule;
                  const Icon = item.Icon;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectModule(item.key);
                          if (isMobile) setMobileOpen(false);
                        }}
                        title={collapsed && !isMobile ? item.label : undefined}
                        className={`w-full flex items-center gap-3 px-3 rounded-md text-sm font-medium transition-colors ${
                          isMobile ? 'py-2.5 min-h-[44px]' : 'py-1.5 min-h-[36px]'
                        } ${
                          active
                            ? 'bg-[#17445C] text-white'
                            : 'text-[#C5D3DF] hover:bg-[#17445C]/50 hover:text-white'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 shrink-0 ${active ? 'text-[#E5B65C]' : 'text-[#66869A]'}`}
                          aria-hidden="true"
                        />
                        {(!collapsed || isMobile) && (
                          <span className="truncate flex-1 text-right">{item.label}</span>
                        )}
                        {(!collapsed || isMobile) &&
                          item.key === 'notifications' &&
                          unreadNotifications > 0 && (
                            <span className="text-[11px] font-mono tabular-nums font-bold px-1.5 py-0.5 rounded bg-[#C99A45] text-[#102638]">
                              {unreadNotifications}
                            </span>
                          )}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
    );
  };

  return (
    <div className="min-h-screen flex bg-[#F3F6F9] dark:bg-[#101A24] text-[#233747] dark:text-[#E8EEF3]">
      {/* Desktop Right-Side Sidebar (RTL start) */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 bg-[#102638] dark:bg-[#0B1520] text-white border-l border-[#203C50]/60 transition-all duration-200 no-print ${
          collapsed ? 'w-[76px]' : 'w-[272px]'
        }`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-md bg-[#17445C] border border-[#C99A45]/50 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 36 36" className="w-5 h-5 text-[#E5B65C]" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 4L30 11V25L18 32L6 25V11L18 4Z" />
                <path d="M18 10V26M12 14.5L18 18L24 14.5" stroke="#078C8C" strokeWidth="2" />
              </svg>
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">موائع المكامن (PVT)</p>
                <p className="text-[11px] text-[#A9B7C4] truncate">نظام الإدارة المتكامل</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية'}
            className="p-1.5 rounded text-[#A9B7C4] hover:text-white hover:bg-[#17445C] transition-colors shrink-0"
          >
            {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {renderNavLinks(false)}

        <div className="p-2.5 border-t border-white/10 space-y-0.5">
          <button
            type="button"
            onClick={() => setPwdModalOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-1.5 min-h-[34px] rounded-md text-xs text-[#C5D3DF] hover:bg-[#17445C]/60 hover:text-white transition-colors"
          >
            <KeyRound className="w-4 h-4 shrink-0 text-[#66869A]" />
            {!collapsed && <span>تغيير كلمة المرور</span>}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-1.5 min-h-[34px] rounded-md text-xs text-red-300 hover:bg-red-950/50 hover:text-red-200 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>تسجيل الخروج</span>}
          </button>
        </div>
      </aside>

      {/* Mobile / Tablet Drawer Sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div className="w-[280px] max-w-[85vw] bg-[#102638] dark:bg-[#0B1520] text-white flex flex-col h-full shadow-2xl">
            <div className="h-16 px-4 flex items-center justify-between border-b border-white/10">
              <div>
                <p className="text-sm font-bold text-white">شعبة موائع المكامن (PVT)</p>
                <p className="text-[11px] text-[#A9B7C4]">نظام الإدارة المتكامل</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="إغلاق القائمة"
                className="p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-[#A9B7C4] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderNavLinks(true)}
            <div className="p-3 border-t border-white/10 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setPwdModalOpen(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-md text-sm text-[#C5D3DF] hover:bg-[#17445C]"
              >
                <KeyRound className="w-4 h-4" />
                <span>تغيير كلمة المرور</span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-md text-sm text-red-300 hover:bg-red-950/50"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق الخلفية"
            onClick={() => setMobileOpen(false)}
            className="flex-1 bg-black/50"
          />
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white dark:bg-[#192735] border-b border-[#DFE6EC] dark:border-[#2C3D4D] px-4 lg:px-6 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="فتح القائمة الجانبية"
              className="lg:hidden p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] text-[#102638] dark:text-[#E8EEF3]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-[#102638] dark:text-[#E8EEF3] truncate">
                {currentNav.label}
              </h1>
              <p className="hidden sm:block text-[11px] text-[#718096] dark:text-[#A9B7C4] truncate">
                {settings.divisionNameAr} · {settings.companyNameAr}
              </p>
            </div>
          </div>

          {/* Global Search */}
          <div ref={searchRef} className="hidden md:block relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-[#718096] dark:text-[#A9B7C4] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchTerm}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث شامل: موظف، جهاز، وثيقة، مراسلة، مخزون..."
              aria-label="بحث شامل في النظام"
              className="w-full pr-9 pl-3 py-2 min-h-[40px] text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] text-[#233747] dark:text-[#E8EEF3] placeholder:text-[#718096] focus:border-[#078C8C] focus:outline-none"
            />

            {searchOpen && (
              <div className="absolute right-0 left-0 top-full mt-1.5 bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg shadow-lg max-h-96 overflow-y-auto z-50">
                {searchResults.length === 0 ? (
                  <p className="p-4 text-xs text-center text-[#718096] dark:text-[#A9B7C4]">
                    لا توجد نتائج مطابقة لـ «{searchTerm}»
                  </p>
                ) : (
                  <ul className="divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D]">
                    {searchResults.map((r) => (
                      <li key={`${r.module}-${r.id}`}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectModule(r.module);
                            setSearchOpen(false);
                            setSearchTerm('');
                          }}
                          className="w-full text-right px-4 py-2.5 hover:bg-[#F3F6F9] dark:hover:bg-[#203C50]/50 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#102638] dark:text-[#E8EEF3] truncate">
                              {r.title}
                            </p>
                            <p className="text-xs text-[#718096] dark:text-[#A9B7C4] truncate">
                              {r.moduleLabel} · {r.subtitle}
                            </p>
                          </div>
                          <span className="text-xs font-mono text-[#078C8C] dark:text-teal-300 shrink-0" dir="ltr">
                            {r.code}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Right Controls: Notifications, Theme Toggle, Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onSelectModule('notifications')}
              aria-label={`مركز التنبيهات (${unreadNotifications} غير مقروء)`}
              className="relative p-2.5 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] text-[#233747] dark:text-[#E8EEF3] hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] transition-colors"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-mono tabular-nums font-bold inline-flex items-center justify-center">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleDark}
              aria-label={darkMode ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
              className="p-2.5 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] text-[#233747] dark:text-[#E8EEF3] hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] transition-colors"
            >
              {darkMode ? <Sun className="w-4 h-4 text-[#E5B65C]" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="hidden sm:flex items-center gap-2.5 pr-2 border-r border-[#DFE6EC] dark:border-[#2C3D4D]">
              <div className="w-9 h-9 rounded-md bg-[#17445C] text-white text-xs font-bold flex items-center justify-center shrink-0">
                {getArabicInitials(user.fullNameAr)}
              </div>
              <div className="text-right leading-tight">
                <p className="text-xs font-semibold text-[#102638] dark:text-[#E8EEF3] whitespace-nowrap">
                  {user.fullNameAr}
                </p>
                <p className="text-[11px] text-[#078C8C] dark:text-teal-300 whitespace-nowrap">
                  {ROLE_LABELS[user.role].ar}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Active Module Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>

      {/* Password Change Modal */}
      <Modal
        open={pwdModalOpen}
        onClose={() => {
          setPwdModalOpen(false);
          setPwdFeedback(null);
        }}
        title="تغيير كلمة المرور"
        subtitle={`الحساب الحالي: ${user.username}`}
        size="md"
      >
        <form onSubmit={handlePasswordChange} className="space-y-4">
          {pwdFeedback && (
            <div
              className={`p-3 rounded-md text-sm ${
                pwdFeedback.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900'
              }`}
            >
              {pwdFeedback.text}
            </div>
          )}
          <div>
            <label htmlFor="pwd-current" className="block text-sm font-medium mb-1">
              كلمة المرور الحالية
            </label>
            <input
              id="pwd-current"
              type="password"
              dir="ltr"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2.5 min-h-[42px] text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              required
            />
          </div>
          <div>
            <label htmlFor="pwd-new" className="block text-sm font-medium mb-1">
              كلمة المرور الجديدة (8 أحرف + أرقام)
            </label>
            <input
              id="pwd-new"
              type="password"
              dir="ltr"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2.5 min-h-[42px] text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPwdModalOpen(false)}
              className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]"
            >
              إغلاق
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white hover:bg-[#102638]"
            >
              حفظ كلمة المرور
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
