import React, { useEffect, useState } from 'react';
import { Check, CheckCheck, Plus, X } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { AdminRequest, AuthUser } from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { StatusBadge } from '../StatusBadge';

const REQ_TYPES: Record<AdminRequest['requestType'], string> = {
  purchase: 'طلب شراء',
  equipment: 'طلب جهاز / أصل',
  consumables: 'طلب مستهلكات',
  maintenance: 'طلب صيانة خارجية',
  administrative: 'طلب إداري داخلي',
};

export function RequestsView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<AdminRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const [form, setForm] = useState({
    requestType: 'purchase' as AdminRequest['requestType'],
    title: '',
    description: '',
    justification: '',
    priority: 'medium',
  });

  const isManager = user.role === 'manager';
  const canWrite = user.role === 'manager' || user.role === 'engineer';

  const load = () => {
    setLoading(true);
    apiRequest<{ items: AdminRequest[] }>('/requests')
      .then((res) => setItems(res.items))
      .catch((err) => onToast(err.message, 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const submitReq = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/requests', { method: 'POST', body: form });
      onToast('تم رفع الطلب الإداري بنجاح.');
      setModalOpen(false);
      setForm({ requestType: 'purchase', title: '', description: '', justification: '', priority: 'medium' });
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إرسال الطلب.', 'err');
    }
  };

  const decide = async (id: number, status: 'approved' | 'rejected' | 'completed') => {
    try {
      await apiRequest(`/requests/${id}/decision`, {
        method: 'POST',
        body: {
          status,
          decisionNotes:
            status === 'approved'
              ? 'موافق عليه من إدارة الشعبة'
              : status === 'completed'
                ? 'تم التنفيذ والإغلاق الإداري'
                : 'مرفوض حالياً',
        },
      });
      onToast('تم تحديث حالة الطلب وتسجيل القرار في سجل التدقيق.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تنفيذ القرار.', 'err');
    }
  };

  const visible = statusFilter === 'all' ? items : items.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">طلبات المشتريات والطلبات الإدارية</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            تقديم طلبات الشراء والمستهلكات والطلبات الإدارية ومتابعة مسار الاعتماد والتنفيذ.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء طلب جديد</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : (
        <DataTable
          rows={visible}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث برقم الطلب أو العنوان أو مقدم الطلب..."
          searchFilter={(r, q) => `${r.requestNumber} ${r.title} ${r.requesterName} ${r.description}`.toLowerCase().includes(q)}
          toolbarExtra={
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F6F9] dark:bg-[#101A24] rounded-md">
              {[
                { key: 'all', label: `الكل (${items.length})` },
                { key: 'submitted', label: 'قيد الاعتماد' },
                { key: 'approved', label: 'معتمد' },
                { key: 'completed', label: 'مكتمل' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setStatusFilter(t.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                    statusFilter === t.key ? 'bg-white dark:bg-[#192735] text-[#102638] dark:text-white shadow-xs' : 'text-[#718096]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
          columns={[
            {
              key: 'no',
              header: 'رقم الطلب',
              render: (r) => (
                <div>
                  <p className="font-mono text-xs font-semibold text-[#078C8C]" dir="ltr">{r.requestNumber}</p>
                  <p className="text-[11px] text-[#718096]">{REQ_TYPES[r.requestType]}</p>
                </div>
              ),
            },
            {
              key: 'title',
              header: 'العنوان والمبرر',
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs">{r.title}</p>
                  <p className="text-[11px] text-[#718096] max-w-sm truncate">{r.description}</p>
                </div>
              ),
            },
            { key: 'by', header: 'مقدم الطلب', render: (r) => <div className="text-xs"><p>{r.requesterName}</p><p className="font-mono text-[11px] text-[#718096]">{r.submissionDate}</p></div> },
            { key: 'prio', header: 'الأولوية', render: (r) => <StatusBadge status={r.priority} /> },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'act',
              header: 'قرار الإدارة',
              render: (r) =>
                isManager && (r.status === 'submitted' || r.status === 'under_review') ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => decide(r.id, 'approved')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-700 hover:bg-emerald-800 text-white"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>اعتماد</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(r.id, 'rejected')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-red-700 hover:bg-red-800 text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>رفض</span>
                    </button>
                  </div>
                ) : isManager && r.status === 'approved' ? (
                  <button
                    type="button"
                    onClick={() => decide(r.id, 'completed')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-[#078C8C] text-white"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>إكمال</span>
                  </button>
                ) : (
                  <span className="text-xs text-[#718096]">{r.managerName || '—'}</span>
                ),
            },
          ]}
        />
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="تقديم طلب شراء أو طلب إداري" size="lg">
        <form onSubmit={submitReq} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">نوع الطلب</label>
              <select value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value as AdminRequest['requestType'] })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="purchase">طلب شراء</option>
                <option value="equipment">طلب تجهيز جهاز / أصل</option>
                <option value="consumables">طلب مستهلكات مخزنية</option>
                <option value="maintenance">طلب صيانة</option>
                <option value="administrative">طلب إداري داخلي</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">درجة الأولوية</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="urgent">عاجلة</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">عنوان الطلب *</label>
            <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">التفاصيل والمواصفات *</label>
            <textarea rows={2} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">المبرر الإداري / التشغيلي</label>
            <textarea rows={2} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">رفع الطلب</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
