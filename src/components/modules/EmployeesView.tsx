import React, { useEffect, useState } from 'react';
import { Archive, Edit3, Eye, FileSpreadsheet, Plus, Printer } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { AuthUser, Employee } from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { ConfirmDialog, Modal } from '../Modal';
import { PrintReportModal } from '../PrintReportModal';
import { StatusBadge } from '../StatusBadge';

interface EmployeeProfile {
  employee: Employee;
  leaves: Array<{ id: number; leave_type_name: string; start_date: string; end_date: string; days_count: number; status: string }>;
  trainings: Array<{ id: number; course_title: string; provider: string; start_date: string; status: string }>;
  equipment: Array<{ id: number; equipment_code: string; name_ar: string; status: string; location: string }>;
  documents: Array<{ id: number; doc_number: string; title: string; category: string; creation_date: string; status: string }>;
}

const EMPTY_FORM = {
  employeeCode: '',
  fullNameAr: '',
  fullNameEn: '',
  jobTitle: '',
  section: 'إدارة الشعبة',
  qualification: 'بكالوريوس',
  specialization: '',
  category: 'هندسي',
  status: 'active' as Employee['status'],
  hireDate: new Date().toISOString().slice(0, 10),
  birthDate: '',
  phone: '',
  extension: '',
  email: '',
  workplace: 'مبنى المختبرات المركزي',
  jobDescription: '',
  emergencyContact: '',
  notes: '',
};

export function EmployeesView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<Employee[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Employee | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const isManager = user.role === 'manager';

  const load = () => {
    setLoading(true);
    apiRequest<{ items: Employee[] }>('/employees')
      .then((res) => setItems(res.items))
      .catch((err) => onToast(err.message, 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      employeeCode: `PVT-${1000 + items.length + 1}`,
    });
    setFormOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setForm({
      employeeCode: emp.employeeCode,
      fullNameAr: emp.fullNameAr,
      fullNameEn: emp.fullNameEn,
      jobTitle: emp.jobTitle,
      section: emp.section,
      qualification: emp.qualification,
      specialization: emp.specialization,
      category: emp.category,
      status: emp.status,
      hireDate: emp.hireDate,
      birthDate: emp.birthDate || '',
      phone: emp.phone,
      extension: emp.extension,
      email: emp.email,
      workplace: emp.workplace,
      jobDescription: emp.jobDescription,
      emergencyContact: emp.emergencyContact || '',
      notes: emp.notes,
    });
    setFormOpen(true);
  };

  const openProfile = async (emp: Employee) => {
    try {
      const data = await apiRequest<EmployeeProfile>(`/employees/${emp.id}/profile`);
      setProfile(data);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر فتح الملف الشخصي.', 'err');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeCode.trim() || !form.fullNameAr.trim() || !form.jobTitle.trim()) {
      onToast('يرجى إدخال الرقم الوظيفي والاسم بالعربية والعنوان الوظيفي.', 'err');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await apiRequest(`/employees/${editingId}`, { method: 'PUT', body: form });
        onToast('تم تحديث بيانات الموظف بنجاح.');
      } else {
        await apiRequest('/employees', { method: 'POST', body: form });
        onToast('تم تسجيل الموظف الجديد في قاعدة البيانات.');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل حفظ البيانات.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setSaving(true);
    try {
      await apiRequest(`/employees/${archiveTarget.id}`, { method: 'DELETE' });
      onToast(`تمت أرشفة ملف الموظف ${archiveTarget.fullNameAr}.`);
      setArchiveTarget(null);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر الأرشفة.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const visibleItems = statusFilter === 'all' ? items : items.filter((e) => e.status === statusFilter);

  const columns: ColumnDef<Employee>[] = [
    {
      key: 'code',
      header: 'الرقم الوظيفي',
      sortable: true,
      sortValue: (r) => r.employeeCode,
      render: (r) => (
        <span className="font-mono tabular-nums text-xs font-semibold text-[#078C8C] dark:text-teal-300" dir="ltr">
          {r.employeeCode}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'الاسم الكامل',
      sortable: true,
      sortValue: (r) => r.fullNameAr,
      render: (r) => (
        <div>
          <p className="font-semibold text-[#102638] dark:text-[#E8EEF3]">{r.fullNameAr}</p>
          {r.fullNameEn && (
            <p className="text-[11px] text-[#718096] dark:text-[#A9B7C4]" dir="ltr">
              {r.fullNameEn}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'job',
      header: 'العنوان الوظيفي والوحدة',
      render: (r) => (
        <div>
          <p className="text-xs font-medium">{r.jobTitle}</p>
          <p className="text-[11px] text-[#718096] dark:text-[#A9B7C4]">{r.section}</p>
        </div>
      ),
    },
    {
      key: 'qual',
      header: 'المؤهل والتخصص',
      mobileHidden: true,
      render: (r) => (
        <span className="text-xs">
          {r.qualification} {r.specialization ? `— ${r.specialization}` : ''}
        </span>
      ),
    },
    {
      key: 'contact',
      header: 'التواصل الداخلي',
      mobileHidden: true,
      render: (r) => (
        <div className="text-xs tabular-nums">
          <p dir="ltr" className="text-right font-mono">{r.phone || '—'}</p>
          {r.extension && <p className="text-[11px] text-[#718096]">داخلي: {r.extension}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => openProfile(r)}
            aria-label={`عرض ملف ${r.fullNameAr}`}
            className="p-2 min-w-[36px] min-h-[36px] rounded hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] text-[#17445C] dark:text-teal-300"
          >
            <Eye className="w-4 h-4" />
          </button>
          {isManager && (
            <>
              <button
                type="button"
                onClick={() => openEdit(r)}
                aria-label={`تعديل ${r.fullNameAr}`}
                className="p-2 min-w-[36px] min-h-[36px] rounded hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] text-[#233747] dark:text-[#E8EEF3]"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setArchiveTarget(r)}
                aria-label={`أرشفة ${r.fullNameAr}`}
                className="p-2 min-w-[36px] min-h-[36px] rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-700 dark:text-red-400"
              >
                <Archive className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">سجل موظفي الشعبة</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            إدارة ملفات الكادر الوظيفي والمؤهلات والتدريب والعهد مع حماية البيانات الشخصية الحساسة حسب الصلاحية.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#078C8C]" />
            <span>تصدير / طباعة الكشف</span>
          </button>
          {isManager && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] dark:hover:bg-[#067575] text-white whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة موظف جديد</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : (
        <DataTable
          rows={visibleItems}
          columns={columns}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث بالاسم أو الرقم الوظيفي أو الوحدة أو التخصص..."
          searchFilter={(r, q) =>
            `${r.employeeCode} ${r.fullNameAr} ${r.fullNameEn} ${r.jobTitle} ${r.section} ${r.specialization}`
              .toLowerCase()
              .includes(q)
          }
          toolbarExtra={
            <div className="flex items-center gap-1 p-1 bg-[#F3F6F9] dark:bg-[#101A24] rounded-md">
              {[
                { key: 'all', label: `الكل (${items.length})` },
                { key: 'active', label: 'على رأس العمل' },
                { key: 'on_leave', label: 'في إجازة' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    statusFilter === tab.key
                      ? 'bg-white dark:bg-[#192735] text-[#102638] dark:text-white shadow-xs'
                      : 'text-[#718096] dark:text-[#A9B7C4] hover:text-[#102638] dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          }
        />
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'تعديل بيانات الموظف' : 'إضافة ملف موظف جديد'}
        size="xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">الرقم الوظيفي *</label>
              <input
                type="text"
                dir="ltr"
                value={form.employeeCode}
                onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الاسم الكامل (عربي) *</label>
              <input
                type="text"
                value={form.fullNameAr}
                onChange={(e) => setForm({ ...form, fullNameAr: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الاسم الكامل (إنجليزي)</label>
              <input
                type="text"
                dir="ltr"
                value={form.fullNameEn}
                onChange={(e) => setForm({ ...form, fullNameEn: e.target.value })}
                className="w-full px-3 py-2 text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">العنوان الوظيفي *</label>
              <input
                type="text"
                value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الوحدة / القسم *</label>
              <input
                type="text"
                value={form.section}
                onChange={(e) => setForm({ ...form, section: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الحالة الوظيفية</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as Employee['status'] })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              >
                <option value="active">على رأس العمل</option>
                <option value="on_leave">في إجازة</option>
                <option value="seconded">منسّب / منتدب</option>
                <option value="suspended">موقوف مؤقتاً</option>
                <option value="retired">متقاعد</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المؤهل العلمي</label>
              <input
                type="text"
                value={form.qualification}
                onChange={(e) => setForm({ ...form, qualification: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التخصص العلمي</label>
              <input
                type="text"
                value={form.specialization}
                onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الفئة الوظيفية</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              >
                <option value="هندسي">هندسي</option>
                <option value="إداري">إداري</option>
                <option value="فني">فني</option>
                <option value="إداري / هندسي">إداري / هندسي</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ المباشرة</label>
              <input
                type="date"
                value={form.hireDate}
                onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ الميلاد (سري للمدير)</label>
              <input
                type="date"
                value={form.birthDate}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">رقم الهاتف</label>
              <input
                type="text"
                dir="ltr"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm text-left font-mono rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التحويلة الداخلية</label>
              <input
                type="text"
                dir="ltr"
                value={form.extension}
                onChange={(e) => setForm({ ...form, extension: e.target.value })}
                className="w-full px-3 py-2 text-sm text-left font-mono rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">البريد الإلكتروني</label>
              <input
                type="email"
                dir="ltr"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">جهة الاتصال للطوارئ (سري)</label>
              <input
                type="text"
                value={form.emergencyContact}
                onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">موقع العمل الفعلي</label>
            <input
              type="text"
              value={form.workplace}
              onChange={(e) => setForm({ ...form, workplace: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">الوصف الوظيفي والمهام الموكلة</label>
            <textarea
              rows={2}
              value={form.jobDescription}
              onChange={(e) => setForm({ ...form, jobDescription: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[#DFE6EC] dark:border-[#2C3D4D]">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] text-white disabled:opacity-60"
            >
              {saving ? 'جارٍ الحفظ...' : editingId ? 'حفظ التعديلات' : 'إضافة الموظف'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Employee Profile Modal */}
      <Modal
        open={Boolean(profile)}
        onClose={() => setProfile(null)}
        title={profile ? `الملف الإداري: ${profile.employee.fullNameAr}` : ''}
        subtitle={profile ? `${profile.employee.employeeCode} · ${profile.employee.jobTitle}` : ''}
        size="xl"
      >
        {profile && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#DFE6EC] dark:border-[#2C3D4D] no-print">
              <StatusBadge status={profile.employee.status} />
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md bg-[#102638] text-white"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة بطاقة الموظف</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-[#718096] dark:text-[#A9B7C4]">الاسم بالإنجليزية</p>
                <p className="font-semibold mt-0.5" dir="ltr">{profile.employee.fullNameEn || '—'}</p>
              </div>
              <div>
                <p className="text-[#718096] dark:text-[#A9B7C4]">الوحدة / القسم</p>
                <p className="font-semibold mt-0.5">{profile.employee.section}</p>
              </div>
              <div>
                <p className="text-[#718096] dark:text-[#A9B7C4]">المؤهل والتخصص</p>
                <p className="font-semibold mt-0.5">{profile.employee.qualification} — {profile.employee.specialization}</p>
              </div>
              <div>
                <p className="text-[#718096] dark:text-[#A9B7C4]">تاريخ المباشرة</p>
                <p className="font-mono font-semibold mt-0.5">{profile.employee.hireDate || '—'}</p>
              </div>
              <div>
                <p className="text-[#718096] dark:text-[#A9B7C4]">الهاتف / التحويلة</p>
                <p className="font-mono font-semibold mt-0.5" dir="ltr">{profile.employee.phone} ({profile.employee.extension || '—'})</p>
              </div>
              <div>
                <p className="text-[#718096] dark:text-[#A9B7C4]">موقع العمل</p>
                <p className="font-semibold mt-0.5">{profile.employee.workplace}</p>
              </div>
              {isManager && (
                <>
                  <div>
                    <p className="text-[#718096] dark:text-[#A9B7C4]">تاريخ الميلاد (مقيّد للمدير)</p>
                    <p className="font-mono font-semibold mt-0.5">{profile.employee.birthDate || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[#718096] dark:text-[#A9B7C4]">جهة اتصال الطوارئ (مقيّد)</p>
                    <p className="font-semibold mt-0.5">{profile.employee.emergencyContact || '—'}</p>
                  </div>
                </>
              )}
            </div>

            {profile.employee.jobDescription && (
              <div className="pt-3 border-t border-[#DFE6EC] dark:border-[#2C3D4D] text-xs">
                <p className="font-semibold text-[#102638] dark:text-[#E8EEF3] mb-1">الوصف الوظيفي</p>
                <p className="text-[#718096] dark:text-[#A9B7C4] leading-relaxed">{profile.employee.jobDescription}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[#DFE6EC] dark:border-[#2C3D4D] text-xs">
              <div>
                <h4 className="font-bold text-[#102638] dark:text-[#E8EEF3] mb-2">العهد والمعدات المسندة ({profile.equipment.length})</h4>
                {profile.equipment.length === 0 ? (
                  <p className="text-[#718096]">لا توجد عهد أجهزة مسجلة.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {profile.equipment.map((q) => (
                      <li key={q.id} className="flex items-center justify-between py-1 border-b border-[#DFE6EC]/60 dark:border-[#2C3D4D]">
                        <span>{q.name_ar}</span>
                        <span className="font-mono text-[#078C8C]">{q.equipment_code}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="font-bold text-[#102638] dark:text-[#E8EEF3] mb-2">سجل الدورات التدريبية ({profile.trainings.length})</h4>
                {profile.trainings.length === 0 ? (
                  <p className="text-[#718096]">لا توجد دورات مسجلة.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {profile.trainings.map((t) => (
                      <li key={t.id} className="flex items-center justify-between py-1 border-b border-[#DFE6EC]/60 dark:border-[#2C3D4D]">
                        <span className="truncate">{t.course_title}</span>
                        <StatusBadge status={t.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
        title="تأكيد أرشفة ملف موظف"
        message={`هل تريد أرشفة ملف الموظف "${archiveTarget?.fullNameAr}"؟ سيتم حفظ سجلاته التاريخية بأمان وإخفاؤه من القائمة النشطة.`}
        confirmLabel="تأكيد الأرشفة"
        danger
        busy={saving}
      />

      <PrintReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        moduleKey="employees"
        canExport={isManager}
      />
    </div>
  );
}
