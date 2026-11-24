import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpLeft,
  Briefcase,
  ClipboardList,
  FileArchive,
  Package,
  RefreshCw,
  Users,
  Wrench,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../../lib/api';
import type { AuthUser, DashboardSummary, ModuleKey } from '../../shared/types';
import { StatusBadge } from '../StatusBadge';

const CHART_COLORS = ['#078C8C', '#C99A45', '#4A7C9B', '#DC2626', '#66869A'];

interface DashboardViewProps {
  user: AuthUser;
  onNavigate: (m: ModuleKey) => void;
}

export function DashboardView({ user, onNavigate }: DashboardViewProps) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    apiRequest<DashboardSummary>('/dashboard')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-white dark:bg-[#192735] border border-red-200 dark:border-red-900 rounded-lg text-center space-y-3">
        <p className="text-sm text-red-700 dark:text-red-300">{error || 'تعذر تحميل بيانات لوحة القيادة.'}</p>
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 text-sm font-medium rounded-md bg-[#17445C] text-white"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const { kpis } = data;

  const kpiCards: Array<{
    title: string;
    value: number;
    sub: string;
    target: ModuleKey;
    Icon: React.ComponentType<{ className?: string }>;
    accent?: 'teal' | 'amber' | 'red' | 'navy';
  }> = [
    {
      title: 'إجمالي الموظفين',
      value: kpis.totalEmployees,
      sub: `${kpis.activeEmployees} على رأس العمل · ${kpis.onLeaveEmployees} في إجازة`,
      target: 'employees',
      Icon: Users,
      accent: 'navy',
    },
    {
      title: 'المعدات والأصول المسجلة',
      value: kpis.totalEquipment,
      sub: `${kpis.equipmentUnderMaintenance} جهاز قيد الصيانة حالياً`,
      target: 'equipment',
      Icon: Briefcase,
      accent: 'teal',
    },
    {
      title: 'معايرات مستحقة أو متأخرة',
      value: kpis.upcomingCalibrations,
      sub: 'تتطلب متابعة وتجديد شهادات',
      target: 'maintenance',
      Icon: Wrench,
      accent: kpis.upcomingCalibrations > 0 ? 'amber' : 'teal',
    },
    {
      title: 'الوثائق والتقارير المؤرشفة',
      value: kpis.totalDocuments,
      sub: 'محفوظة محلياً مع تتبع الإصدارات',
      target: 'documents',
      Icon: FileArchive,
      accent: 'navy',
    },
    {
      title: 'الطلبات الإدارية المعلقة',
      value: kpis.pendingRequests + kpis.pendingLeaves,
      sub: `${kpis.pendingRequests} مشتريات/إداري · ${kpis.pendingLeaves} إجازات`,
      target: 'requests',
      Icon: ClipboardList,
      accent: kpis.pendingRequests + kpis.pendingLeaves > 0 ? 'amber' : 'teal',
    },
    {
      title: 'المهام الداخلية القائمة',
      value: kpis.outstandingTasks,
      sub: 'مهام قيد التنفيذ أو الانتظار',
      target: 'meetings',
      Icon: AlertTriangle,
      accent: 'navy',
    },
    {
      title: 'أصناف مخزنية دون الحد الأدنى',
      value: kpis.lowStockCount,
      sub: 'تحتاج طلب تجهيز أو استلام مخزني',
      target: 'inventory',
      Icon: Package,
      accent: kpis.lowStockCount > 0 ? 'red' : 'teal',
    },
    {
      title: 'مراسلات متأخرة المتابعة',
      value: kpis.overdueCorrespondence,
      sub: 'كتب ومذكرات تجاوزت موعد الرد',
      target: 'correspondence',
      Icon: AlertTriangle,
      accent: kpis.overdueCorrespondence > 0 ? 'red' : 'teal',
    },
  ];

  const accentText = {
    navy: 'text-[#102638] dark:text-[#E8EEF3]',
    teal: 'text-[#078C8C] dark:text-teal-300',
    amber: 'text-amber-700 dark:text-amber-400',
    red: 'text-red-700 dark:text-red-400',
  };

  return (
    <div className="space-y-6">
      {/* Executive Header Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#102638] dark:text-[#E8EEF3]">
            مرحباً، {user.fullNameAr}
          </h2>
          <p className="text-sm text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            ملخص إداري مباشر من قاعدة البيانات المركزية لشعبة موائع المكامن (PVT).
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] text-[#102638] dark:text-[#E8EEF3] hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] transition-colors whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>تحديث الإحصائيات</span>
        </button>
      </div>

      {/* KPI Grid */}
      <section aria-label="المؤشرات الإدارية الرئيسية" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.Icon;
          return (
            <button
              key={card.title}
              type="button"
              onClick={() => onNavigate(card.target)}
              className="text-right bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] hover:border-[#078C8C] dark:hover:border-teal-500 rounded-lg p-5 transition-colors flex flex-col justify-between gap-3 group"
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <span className="text-xs font-semibold text-[#66869A] dark:text-[#A9B7C4]">
                  {card.title}
                </span>
                <Icon className="w-4 h-4 text-[#66869A] group-hover:text-[#078C8C] transition-colors shrink-0" />
              </div>
              <div className="flex items-baseline justify-between gap-2 w-full">
                <span className={`text-3xl font-bold font-mono tabular-nums ${accentText[card.accent || 'navy']}`}>
                  {card.value}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-[#078C8C] dark:text-teal-300 opacity-80 group-hover:opacity-100">
                  <span>عرض</span>
                  <ArrowUpLeft className="w-3 h-3" />
                </span>
              </div>
              <p className="text-xs text-[#718096] dark:text-[#A9B7C4] truncate w-full">{card.sub}</p>
            </button>
          );
        })}
      </section>

      {/* Visual Analytics Row */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[#102638] dark:text-[#E8EEF3]">
                توزيع الحالة التشغيلية للمعدات
              </h3>
              <p className="text-xs text-[#718096] dark:text-[#A9B7C4]">إحصاء فعلي من سجل الأصول</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('equipment')}
              className="text-xs font-semibold text-[#078C8C] hover:underline"
            >
              سجل المعدات
            </button>
          </div>
          {data.equipmentByStatus.length === 0 ? (
            <p className="text-sm text-[#718096] py-16 text-center">لا توجد معدات مسجلة بعد.</p>
          ) : (
            <div className="h-60 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.equipmentByStatus}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={84}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {data.equipmentByStatus.map((entry, idx) => (
                      <Cell key={entry.key} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-[#DFE6EC] dark:border-[#2C3D4D] text-xs">
            {data.equipmentByStatus.map((entry, idx) => (
              <div key={entry.key} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                />
                <span className="text-[#233747] dark:text-[#E8EEF3]">{entry.name}</span>
                <span className="font-mono tabular-nums font-semibold text-[#718096] dark:text-[#A9B7C4]">
                  ({entry.value})
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[#102638] dark:text-[#E8EEF3]">
                الوثائق المؤرشفة حسب التصنيف
              </h3>
              <p className="text-xs text-[#718096] dark:text-[#A9B7C4]">أكثر التصنيفات استخداماً في الأرشيف</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('documents')}
              className="text-xs font-semibold text-[#078C8C] hover:underline"
            >
              الأرشيف الكامل
            </button>
          </div>
          {data.documentsByCategory.length === 0 ? (
            <p className="text-sm text-[#718096] py-16 text-center">لا توجد وثائق مؤرشفة بعد.</p>
          ) : (
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.documentsByCategory} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#DFE6EC" opacity={0.4} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#66869A' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#66869A' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="عدد الوثائق" fill="#078C8C" radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      {/* Bottom 3-Column Operational Feed */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Deadlines */}
        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[#102638] dark:text-[#E8EEF3]">المواعيد والاستحقاقات القادمة</h3>
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              className="text-xs font-semibold text-[#078C8C] hover:underline"
            >
              كل التنبيهات
            </button>
          </div>
          {data.upcomingDeadlines.length === 0 ? (
            <p className="text-xs text-[#718096] py-8 text-center">لا توجد استحقاقات متأخرة أو قريبة.</p>
          ) : (
            <ul className="divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D]">
              {data.upcomingDeadlines.map((d) => (
                <li key={d.id} className="py-2.5">
                  <button
                    type="button"
                    onClick={() => onNavigate(d.module)}
                    className="w-full text-right hover:opacity-80 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge status={d.severity} customLabel={d.categoryLabel} />
                      <span className="text-xs font-mono tabular-nums text-[#718096] dark:text-[#A9B7C4]" dir="ltr">
                        {d.dueDate}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-[#233747] dark:text-[#E8EEF3] truncate">
                      {d.title}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent Documents */}
        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[#102638] dark:text-[#E8EEF3]">أحدث الوثائق والتقارير</h3>
            <button
              type="button"
              onClick={() => onNavigate('documents')}
              className="text-xs font-semibold text-[#078C8C] hover:underline"
            >
              إضافة وثيقة
            </button>
          </div>
          {data.recentDocuments.length === 0 ? (
            <p className="text-xs text-[#718096] py-8 text-center">لم تُرفع وثائق بعد.</p>
          ) : (
            <ul className="divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D]">
              {data.recentDocuments.map((doc) => (
                <li key={doc.id} className="py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-[#078C8C] dark:text-teal-300" dir="ltr">
                      {doc.docNumber}
                    </span>
                    <StatusBadge status={doc.status} />
                  </div>
                  <p className="text-xs font-semibold text-[#102638] dark:text-[#E8EEF3] truncate">
                    {doc.title}
                  </p>
                  <p className="text-[11px] text-[#718096] dark:text-[#A9B7C4]">
                    {doc.category} · {doc.author}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent Activities */}
        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[#102638] dark:text-[#E8EEF3]">أحدث النشاطات الإدارية</h3>
            {user.role === 'manager' && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className="text-xs font-semibold text-[#078C8C] hover:underline"
              >
                سجل التدقيق
              </button>
            )}
          </div>
          {data.recentActivities.length === 0 ? (
            <p className="text-xs text-[#718096] py-8 text-center">لا توجد نشاطات مسجلة.</p>
          ) : (
            <ul className="divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D]">
              {data.recentActivities.map((act) => (
                <li key={act.id} className="py-2.5 space-y-0.5">
                  <p className="text-xs text-[#233747] dark:text-[#E8EEF3] leading-relaxed">
                    {act.description}
                  </p>
                  <p className="text-[11px] text-[#718096] dark:text-[#A9B7C4] tabular-nums">
                    {act.username} · <span dir="ltr">{act.createdAt.slice(0, 16)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
