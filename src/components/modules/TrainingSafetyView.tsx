import React, { useEffect, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { AuthUser, Employee, SafetyRecord, TrainingRecord } from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { StatusBadge } from '../StatusBadge';

export function TrainingView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<TrainingRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const [form, setForm] = useState({
    courseTitle: '',
    provider: '',
    location: '',
    employeeId: '',
    employeeName: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    certificateNumber: '',
    competencyArea: '',
    status: 'planned',
    notes: '',
  });

  const canWrite = user.role === 'manager' || user.role === 'engineer';

  const load = async () => {
    setLoading(true);
    try {
      const [tRes, eRes] = await Promise.all([
        apiRequest<{ items: TrainingRecord[] }>('/training'),
        apiRequest<{ items: Employee[] }>('/employees'),
      ]);
      setItems(tRes.items);
      setEmployees(eRes.items);
      if (eRes.items.length > 0 && !form.employeeName) {
        setForm((f) => ({
          ...f,
          employeeId: String(eRes.items[0].id),
          employeeName: eRes.items[0].fullNameAr,
        }));
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحميل سجلات التدريب.', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/training', {
        method: 'POST',
        body: { ...form, employeeId: form.employeeId ? Number(form.employeeId) : null },
      });
      onToast('تمت إضافة السجل التدريبي بنجاح.');
      setModalOpen(false);
      setForm((f) => ({ ...f, courseTitle: '', provider: '', certificateNumber: '', notes: '' }));
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل حفظ الدورة التدريبية.', 'err');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">التدريب وتطوير الملاك الوظيفي</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            توثيق الدورات التدريبية والجهات المنفذة والشهادات والكفاءات المطلوبة لموظفي الشعبة.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة دورة / ترشيح</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : (
        <DataTable
          rows={items}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث بعنوان الدورة، المشارك، أو الجهة المنفذة..."
          searchFilter={(r, q) => `${r.courseTitle} ${r.employeeName} ${r.provider} ${r.competencyArea}`.toLowerCase().includes(q)}
          columns={[
            { key: 'course', header: 'الدورة التدريبية والجهة', render: (r) => <div><p className="font-semibold text-xs">{r.courseTitle}</p><p className="text-[11px] text-[#718096]">{r.provider} · {r.location}</p></div> },
            { key: 'emp', header: 'الموظف المشارك', render: (r) => <span className="text-xs font-medium">{r.employeeName}</span> },
            { key: 'comp', header: 'مجال الكفاءة', mobileHidden: true, render: (r) => <span className="text-xs">{r.competencyArea || '—'}</span> },
            { key: 'dates', header: 'التاريخ', render: (r) => <span className="font-mono text-xs tabular-nums" dir="ltr">{r.startDate} → {r.endDate}</span> },
            { key: 'cert', header: 'رقم الشهادة', mobileHidden: true, render: (r) => <span className="font-mono text-xs">{r.certificateNumber || '—'}</span> },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="إضافة سجل تدريبي جديد" size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">اسم الدورة التدريبية *</label>
              <input type="text" required value={form.courseTitle} onChange={(e) => setForm({ ...form, courseTitle: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الجهة المنفذة *</label>
              <input type="text" required value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الموظف المشارك *</label>
              <select
                value={form.employeeId}
                onChange={(e) => {
                  const emp = employees.find((x) => String(x.id) === e.target.value);
                  setForm({ ...form, employeeId: e.target.value, employeeName: emp?.fullNameAr || '' });
                }}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              >
                {employees.map((e) => <option key={e.id} value={e.id}>{e.fullNameAr}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ البدء *</label>
              <input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ الانتهاء</label>
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">مجال الكفاءة</label>
              <input type="text" value={form.competencyArea} onChange={(e) => setForm({ ...form, competencyArea: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الحالة</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="planned">مخطط لها</option>
                <option value="enrolled">مسجّل / قيد التدريب</option>
                <option value="completed">مكتملة</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ السجل</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const HSE_TYPES: Record<SafetyRecord['recordType'], string> = {
  inspection: 'تفتيش دوري للسلامة',
  observation: 'ملاحظة سلامة',
  incident: 'تقرير حادث / وشيك',
  ppe_distribution: 'توزيع معدات وقاية PPE',
  safety_training: 'توعية وتدريب سلامة',
};

export function SafetyView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<SafetyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const [form, setForm] = useState({
    recordType: 'inspection' as SafetyRecord['recordType'],
    title: '',
    recordDate: new Date().toISOString().slice(0, 10),
    location: '',
    responsibleEmployee: user.fullNameAr,
    severity: 'low',
    description: '',
    correctiveAction: '',
    dueDate: '',
  });

  const canWrite = user.role === 'manager' || user.role === 'engineer';

  const load = () => {
    setLoading(true);
    apiRequest<{ items: SafetyRecord[] }>('/safety')
      .then((res) => setItems(res.items))
      .catch((err) => onToast(err.message, 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/safety', { method: 'POST', body: form });
      onToast('تم توثيق سجل السلامة المهنية بنجاح.');
      setModalOpen(false);
      setForm((f) => ({ ...f, title: '', description: '', correctiveAction: '' }));
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر حفظ السجل.', 'err');
    }
  };

  const closeRecord = async (rec: SafetyRecord) => {
    try {
      await apiRequest(`/safety/${rec.id}`, {
        method: 'PATCH',
        body: { followUpStatus: 'closed', correctiveAction: rec.correctiveAction || 'تم تنفيذ الإجراء التصحيحي وإغلاق السجل' },
      });
      onToast(`تم إغلاق سجل السلامة ${rec.recordNumber}.`);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر التحديث.', 'err');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">سجلات الصحة والسلامة والتفتيش (HSE)</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            توثيق إداري لجولات التفتيش، ملاحظات السلامة، توزيع معدات الوقاية الشخصية PPE، والإجراءات التصحيحية.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل فحص / ملاحظة HSE</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : (
        <DataTable
          rows={items}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث برقم السجل أو العنوان أو الموقع..."
          searchFilter={(r, q) => `${r.recordNumber} ${r.title} ${r.location} ${r.responsibleEmployee}`.toLowerCase().includes(q)}
          columns={[
            { key: 'no', header: 'رقم السجل', render: (r) => <div><p className="font-mono text-xs font-semibold text-[#078C8C]" dir="ltr">{r.recordNumber}</p><p className="text-[11px] text-[#718096]">{HSE_TYPES[r.recordType]}</p></div> },
            { key: 'title', header: 'الموضوع والموقع', render: (r) => <div><p className="font-semibold text-xs">{r.title}</p><p className="text-[11px] text-[#718096]">{r.location} · {r.responsibleEmployee}</p></div> },
            { key: 'date', header: 'التاريخ', render: (r) => <span className="font-mono text-xs tabular-nums">{r.recordDate}</span> },
            { key: 'sev', header: 'الأهمية', render: (r) => <StatusBadge status={r.severity} /> },
            { key: 'status', header: 'حالة المتابعة', render: (r) => <StatusBadge status={r.followUpStatus} /> },
            {
              key: 'act',
              header: 'إجراء',
              render: (r) =>
                canWrite && r.followUpStatus !== 'closed' ? (
                  <button
                    type="button"
                    onClick={() => closeRecord(r)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-700 hover:bg-emerald-800 text-white"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>إغلاق</span>
                  </button>
                ) : (
                  <span className="text-xs text-[#718096]">مغلق</span>
                ),
            },
          ]}
        />
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="توثيق سجل سلامة مهنية وتفتيش" size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">نوع السجل</label>
              <select value={form.recordType} onChange={(e) => setForm({ ...form, recordType: e.target.value as SafetyRecord['recordType'] })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="inspection">تفتيش دوري للسلامة</option>
                <option value="observation">ملاحظة سلامة</option>
                <option value="incident">تقرير حادث / حادث وشيك</option>
                <option value="ppe_distribution">توزيع معدات الوقاية PPE</option>
                <option value="safety_training">توعية وتدريب سلامة</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">مستوى الأهمية</label>
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="low">منخفض</option>
                <option value="medium">متوسط</option>
                <option value="high">مرتفع</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">العنوان *</label>
              <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الموقع</label>
              <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ التوثيق</label>
              <input type="date" value={form.recordDate} onChange={(e) => setForm({ ...form, recordDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">الوصف والمشاهدات *</label>
            <textarea rows={2} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">الإجراء التصحيحي المتخذ / المطلوب</label>
            <textarea rows={2} value={form.correctiveAction} onChange={(e) => setForm({ ...form, correctiveAction: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ السجل</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
