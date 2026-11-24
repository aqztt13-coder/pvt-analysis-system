import React, { useEffect, useState } from 'react';
import { ArrowUpLeft, Bell, CheckCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { ModuleKey, SystemNotification } from '../../shared/types';
import { StatusBadge } from '../StatusBadge';

export function NotificationsView({
  onNavigate,
  onCountChanged,
  onToast,
}: {
  onNavigate: (m: ModuleKey) => void;
  onCountChanged: (unread: number) => void;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<SystemNotification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiRequest<{ items: SystemNotification[]; unreadCount: number }>('/notifications')
      .then((res) => {
        setItems(res.items);
        onCountChanged(res.unreadCount);
      })
      .catch((err) => onToast(err.message, 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const markRead = async (n: SystemNotification) => {
    if (!n.isRead) {
      await apiRequest(`/notifications/${encodeURIComponent(n.id)}/read`, { method: 'POST' });
    }
    onNavigate(n.targetModule);
    load();
  };

  const markAllRead = async () => {
    await apiRequest('/notifications/read-all', { method: 'POST' });
    onToast('تم تأشير جميع التنبيهات كمقروءة.');
    load();
  };

  const visible = items.filter((n) => {
    if (filter === 'unread') return !n.isRead;
    if (filter === 'critical') return n.severity === 'critical';
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">مركز التنبيهات والاستحقاقات</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            تنبيهات حية مشتقة تلقائياً من تواريخ الصيانة والمعايرة والضمانات والمخزون والإجازات والمهام.
          </p>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] hover:bg-[#F3F6F9] dark:hover:bg-[#203C50]"
        >
          <CheckCheck className="w-4 h-4 text-[#078C8C]" />
          <span>تأشير الكل كمقروء</span>
        </button>
      </div>

      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg w-fit">
        {[
          { key: 'all', label: `الكل (${items.length})` },
          { key: 'unread', label: `غير مقروء (${items.filter((x) => !x.isRead).length})` },
          { key: 'critical', label: `حرج ومتأخر (${items.filter((x) => x.severity === 'critical').length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key as typeof filter)}
            className={`px-4 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
              filter === t.key ? 'bg-[#102638] dark:bg-[#078C8C] text-white' : 'text-[#718096]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-48 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : visible.length === 0 ? (
        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-12 text-center space-y-2">
          <Bell className="w-8 h-8 text-[#66869A] mx-auto" />
          <p className="text-sm font-semibold">لا توجد تنبيهات ضمن هذا التصنيف</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D]">
          {visible.map((n) => (
            <div
              key={n.id}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                !n.isRead ? 'bg-[#DDF2F0]/25 dark:bg-[#078C8C]/10' : ''
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={n.severity} />
                  {n.dueDate && (
                    <span className="text-xs font-mono text-[#718096] tabular-nums" dir="ltr">
                      الاستحقاق: {n.dueDate}
                    </span>
                  )}
                  {!n.isRead && (
                    <span className="text-[11px] font-semibold text-[#078C8C] dark:text-teal-300">جديد</span>
                  )}
                </div>
                <p className="text-sm font-bold text-[#102638] dark:text-[#E8EEF3]">{n.title}</p>
                <p className="text-xs text-[#718096] dark:text-[#A9B7C4]">{n.message}</p>
              </div>
              <button
                type="button"
                onClick={() => markRead(n)}
                className="self-start sm:self-center inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#101A24] hover:border-[#078C8C] text-[#17445C] dark:text-teal-300 whitespace-nowrap"
              >
                <span>الانتقال للسجل</span>
                <ArrowUpLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
