import React, { useEffect, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Plus } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { AuthUser, CorrespondenceRecord } from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { PrintReportModal } from '../PrintReportModal';
import { StatusBadge } from '../StatusBadge';

const TYPE_LABELS: Record<CorrespondenceRecord['correspondenceType'], string> = {
  incoming: 'وارد',
  outgoing: 'صادر',
  internal_memo: 'مذكرة داخلية',
  official_letter: 'كتاب رسمي',
};

export function CorrespondenceView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<CorrespondenceRecord[]>([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [form, setForm] = useState({
    refNumber: '',
    correspondenceType: 'incoming' as CorrespondenceRecord['correspondenceType'],
    subject: '',
    sender: '',
    recipient: 'شعبة موائع المكامن (PVT)',
    receivedDate: new Date().toISOString().slice(0, 10),
    dispatchDate: '',
    relatedDepartment: '',
    responsibleEmployee: user.fullNameAr,
    priority: 'medium',
    requiredAction: '',
    dueDate: '',
    notes: '',
  });

  const canWrite = user.role === 'manager' || user.role === 'engineer';
  const today = new Date().toISOString().slice(0, 10);

  const load = () => {
    setLoading(true);
    apiRequest<{ items: CorrespondenceRecord[] }>('/correspondence')
      .then((res) => setItems(res.items))
      .catch((err) => onToast(err.message, 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/correspondence', { method: 'POST', body: form });
      onToast('تم قيد المراسلة في السجل الرسمي.');
      setModalOpen(false);
      setForm((f) => ({ ...f, refNumber: '', subject: '', sender: '', requiredAction: '', notes: '' }));
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل قيد المراسلة.', 'err');
    }
  };

  const markComplete = async (item: CorrespondenceRecord) => {
    try {
      await apiRequest(`/correspondence/${item.id}`, {
        method: 'PATCH',
        body: { status: 'completed', notes: item.notes },
      });
      onToast(`تم إغلاق متابعة المراسلة ${item.refNumber}.`);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر التحديث.', 'err');
    }
  };

  const visible = typeFilter === 'all' ? items : items.filter((i) => i.correspondenceType === typeFilter);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">سجل المراسلات الصادرة والواردة</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            قيد ومتابعة الكتب الرسمية والمذكرات الداخلية مع تنبيهات المراسلات المتأخرة وطباعة السجل.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#078C8C]" />
            <span>طباعة / تصدير السجل</span>
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>قيد مراسلة جديدة</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : (
        <DataTable
          rows={visible}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث بالرقم الإشاري، الموضوع، المرسل، أو المستلم..."
          searchFilter={(r, q) => `${r.refNumber} ${r.subject} ${r.sender} ${r.recipient}`.toLowerCase().includes(q)}
          toolbarExtra={
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F6F9] dark:bg-[#101A24] rounded-md">
              {[
                { key: 'all', label: `الكل (${items.length})` },
                { key: 'incoming', label: 'وارد' },
                { key: 'outgoing', label: 'صادر' },
                { key: 'internal_memo', label: 'مذكرة داخلية' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTypeFilter(t.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                    typeFilter === t.key ? 'bg-white dark:bg-[#192735] text-[#102638] dark:text-white shadow-xs' : 'text-[#718096]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
          columns={[
            {
              key: 'ref',
              header: 'الرقم الإشاري',
              render: (r) => (
                <div>
                  <p className="font-mono text-xs font-semibold text-[#078C8C]" dir="ltr">{r.refNumber}</p>
                  <p className="text-[11px] text-[#718096]">{TYPE_LABELS[r.correspondenceType]}</p>
                </div>
              ),
            },
            {
              key: 'subj',
              header: 'الموضوع والجهات',
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs text-[#102638] dark:text-[#E8EEF3]">{r.subject}</p>
                  <p className="text-[11px] text-[#718096]">من: {r.sender} ← إلى: {r.recipient}</p>
                </div>
              ),
            },
            { key: 'priority', header: 'الأولوية', render: (r) => <StatusBadge status={r.priority} /> },
            {
              key: 'due',
              header: 'موعد المتابعة',
              render: (r) => {
                const overdue = r.dueDate && r.status !== 'completed' && r.status !== 'archived' && r.dueDate < today;
                return (
                  <span className={`font-mono text-xs tabular-nums ${overdue ? 'text-red-700 dark:text-red-400 font-bold' : ''}`}>
                    {r.dueDate || '—'}
                  </span>
                );
              },
            },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'act',
              header: 'إجراء',
              render: (r) =>
                canWrite && r.status !== 'completed' && r.status !== 'archived' ? (
                  <button
                    type="button"
                    onClick={() => markComplete(r)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-700 hover:bg-emerald-800 text-white"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>إنجاز</span>
                  </button>
                ) : (
                  <span className="text-xs text-[#718096]">مغلقة</span>
                ),
            },
          ]}
        />
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="قيد مراسلة جديدة" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">الرقم الإشاري *</label>
              <input type="text" dir="ltr" required value={form.refNumber} onChange={(e) => setForm({ ...form, refNumber: e.target.value })} placeholder="IN-2026-401" className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">نوع المراسلة</label>
              <select value={form.correspondenceType} onChange={(e) => setForm({ ...form, correspondenceType: e.target.value as CorrespondenceRecord['correspondenceType'] })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="incoming">مراسلة واردة</option>
                <option value="outgoing">مراسلة صادرة</option>
                <option value="internal_memo">مذكرة داخلية</option>
                <option value="official_letter">كتاب رسمي</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">الموضوع *</label>
              <input type="text" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الجهة المرسلة *</label>
              <input type="text" required value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الجهة المستلمة *</label>
              <input type="text" required value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الأولوية</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="urgent">عاجلة</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ الاستحقاق / الرد</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">الإجراء المطلوب</label>
            <textarea rows={2} value={form.requiredAction} onChange={(e) => setForm({ ...form, requiredAction: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ القيد</button>
          </div>
        </form>
      </Modal>

      <PrintReportModal open={reportOpen} onClose={() => setReportOpen(false)} moduleKey="correspondence" canExport={user.role !== 'viewer'} />
    </div>
  );
}
