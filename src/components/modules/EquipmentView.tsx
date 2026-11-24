import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Edit3, FileSpreadsheet, Plus } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type {
  AuthUser,
  Employee,
  EquipmentItem,
  EquipmentTransfer,
  SystemSettings,
} from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { PrintReportModal } from '../PrintReportModal';
import { StatusBadge } from '../StatusBadge';

const EMPTY_EQ = {
  equipmentCode: '',
  nameAr: '',
  nameEn: '',
  category: 'وحدات الضغط والحرارة',
  manufacturer: '',
  model: '',
  serialNumber: '',
  assetNumber: '',
  acquisitionDate: new Date().toISOString().slice(0, 10),
  purchaseInfo: '',
  location: '',
  custodianId: '',
  status: 'operational' as EquipmentItem['status'],
  warrantyExpiry: '',
  notes: '',
};

export function EquipmentView({
  user,
  settings,
  onToast,
}: {
  user: AuthUser;
  settings: SystemSettings;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [transfers, setTransfers] = useState<EquipmentTransfer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_EQ);
  const [transferTarget, setTransferTarget] = useState<EquipmentItem | null>(null);
  const [transferForm, setTransferForm] = useState({ toLocation: '', toCustodianId: '', reason: '' });
  const [reportOpen, setReportOpen] = useState(false);

  const isManager = user.role === 'manager';

  const load = async () => {
    setLoading(true);
    try {
      const [eqRes, empRes] = await Promise.all([
        apiRequest<{ items: EquipmentItem[]; transfers: EquipmentTransfer[] }>('/equipment'),
        apiRequest<{ items: Employee[] }>('/employees'),
      ]);
      setItems(eqRes.items);
      setTransfers(eqRes.transfers);
      setEmployees(empRes.items);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحميل سجل المعدات.', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_EQ,
      equipmentCode: `EQ-PVT-${String(items.length + 1).padStart(3, '0')}`,
      category: settings.equipmentCategories[0] || EMPTY_EQ.category,
    });
    setFormOpen(true);
  };

  const openEdit = (q: EquipmentItem) => {
    setEditingId(q.id);
    setForm({
      equipmentCode: q.equipmentCode,
      nameAr: q.nameAr,
      nameEn: q.nameEn,
      category: q.category,
      manufacturer: q.manufacturer,
      model: q.model,
      serialNumber: q.serialNumber,
      assetNumber: q.assetNumber,
      acquisitionDate: q.acquisitionDate,
      purchaseInfo: q.purchaseInfo,
      location: q.location,
      custodianId: q.custodianId ? String(q.custodianId) : '',
      status: q.status,
      warrantyExpiry: q.warrantyExpiry,
      notes: q.notes,
    });
    setFormOpen(true);
  };

  const saveEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = { ...form, custodianId: form.custodianId ? Number(form.custodianId) : null };
      if (editingId) {
        await apiRequest(`/equipment/${editingId}`, { method: 'PUT', body });
        onToast('تم تحديث بيانات الجهاز بنجاح.');
      } else {
        await apiRequest('/equipment', { method: 'POST', body });
        onToast('تمت إضافة الجهاز إلى سجل الأصول.');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر حفظ بيانات الجهاز.', 'err');
    }
  };

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTarget) return;
    try {
      await apiRequest(`/equipment/${transferTarget.id}/transfer`, {
        method: 'POST',
        body: {
          toLocation: transferForm.toLocation,
          toCustodianId: transferForm.toCustodianId ? Number(transferForm.toCustodianId) : null,
          reason: transferForm.reason,
        },
      });
      onToast('تم توثيق نقل الجهاز وتحديث العهدة والموقع.');
      setTransferTarget(null);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل توثيق النقل.', 'err');
    }
  };

  const visible = statusFilter === 'all' ? items : items.filter((i) => i.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">سجل المعدات والأصول الإدارية</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            إدارة الأصول، الأرقام التسلسلية، العهد الوظيفية، الضمانات، وسجل تنقلات الأجهزة (إداري فقط بدون حسابات مختبرية).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#078C8C]" />
            <span>تقرير جرد المعدات</span>
          </button>
          {isManager && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة جهاز / أصل</span>
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
          searchPlaceholder="بحث برمز الجهاز، الاسم، الرقم التسلسلي، المصنّع، أو الموقع..."
          searchFilter={(r, q) =>
            `${r.equipmentCode} ${r.nameAr} ${r.nameEn} ${r.serialNumber} ${r.assetNumber} ${r.manufacturer} ${r.location}`
              .toLowerCase()
              .includes(q)
          }
          toolbarExtra={
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3F6F9] dark:bg-[#101A24] rounded-md">
              {[
                { key: 'all', label: `الكل (${items.length})` },
                { key: 'operational', label: 'قيد التشغيل' },
                { key: 'under_maintenance', label: 'قيد الصيانة' },
                { key: 'under_inspection', label: 'قيد الفحص' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setStatusFilter(t.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                    statusFilter === t.key
                      ? 'bg-white dark:bg-[#192735] text-[#102638] dark:text-white shadow-xs'
                      : 'text-[#718096] dark:text-[#A9B7C4]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
          columns={[
            {
              key: 'code',
              header: 'رمز الأصل',
              sortable: true,
              sortValue: (r) => r.equipmentCode,
              render: (r) => (
                <div>
                  <p className="font-mono text-xs font-semibold text-[#078C8C] dark:text-teal-300" dir="ltr">{r.equipmentCode}</p>
                  <p className="text-[11px] font-mono text-[#718096]" dir="ltr">{r.assetNumber || '—'}</p>
                </div>
              ),
            },
            {
              key: 'name',
              header: 'اسم الجهاز والمصنّع',
              sortable: true,
              sortValue: (r) => r.nameAr,
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs text-[#102638] dark:text-[#E8EEF3]">{r.nameAr}</p>
                  <p className="text-[11px] text-[#718096]" dir="ltr">
                    {r.manufacturer} {r.model ? `· ${r.model}` : ''} {r.serialNumber ? `· S/N: ${r.serialNumber}` : ''}
                  </p>
                </div>
              ),
            },
            { key: 'loc', header: 'الموقع والعهدة', render: (r) => <div className="text-xs"><p>{r.location}</p><p className="text-[11px] text-[#718096]">{r.custodianName}</p></div> },
            { key: 'warranty', header: 'انتهاء الضمان', mobileHidden: true, render: (r) => <span className="font-mono text-xs tabular-nums">{r.warrantyExpiry || '—'}</span> },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: 'الإجراءات',
              render: (r) =>
                isManager ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      aria-label={`تعديل ${r.nameAr}`}
                      className="p-2 rounded hover:bg-[#F3F6F9] dark:hover:bg-[#203C50]"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTransferTarget(r);
                        setTransferForm({ toLocation: r.location, toCustodianId: r.custodianId ? String(r.custodianId) : '', reason: '' });
                      }}
                      aria-label={`نقل عهدة ${r.nameAr}`}
                      className="p-2 rounded hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] text-[#078C8C]"
                    >
                      <ArrowLeftRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-[#718096]">عرض فقط</span>
                ),
            },
          ]}
        />
      )}

      {/* Transfer Log */}
      {transfers.length > 0 && (
        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5">
          <h3 className="text-sm font-bold text-[#102638] dark:text-[#E8EEF3] mb-3">
            سجل مناقلات المعدات وتغيير العهد
          </h3>
          <div className="divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D] text-xs">
            {transfers.slice(0, 6).map((t) => (
              <div key={t.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">{t.equipmentName}</span>
                  <span className="text-[#718096] mx-2">من {t.fromLocation} ← إلى {t.toLocation}</span>
                  <span className="text-[#078C8C]">({t.toCustodian})</span>
                </div>
                <span className="font-mono text-[#718096] tabular-nums">{t.transferDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Equipment Form Modal */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingId ? 'تعديل سجل الجهاز' : 'تسجيل جهاز / أصل جديد'} size="xl">
        <form onSubmit={saveEquipment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">رمز الجهاز *</label>
              <input type="text" dir="ltr" required value={form.equipmentCode} onChange={(e) => setForm({ ...form, equipmentCode: e.target.value })} className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم الجهاز بالعربية *</label>
              <input type="text" required value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الاسم الفني بالإنجليزية</label>
              <input type="text" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} className="w-full px-3 py-2 text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التصنيف *</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                {settings.equipmentCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الشركة المصنّعة</label>
              <input type="text" dir="ltr" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="w-full px-3 py-2 text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الموديل</label>
              <input type="text" dir="ltr" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="w-full px-3 py-2 text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الرقم التسلسلي (S/N)</label>
              <input type="text" dir="ltr" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">رقم الأصل (Asset No)</label>
              <input type="text" dir="ltr" value={form.assetNumber} onChange={(e) => setForm({ ...form, assetNumber: e.target.value })} className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الحالة التشغيلية</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EquipmentItem['status'] })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="operational">قيد التشغيل</option>
                <option value="under_maintenance">قيد الصيانة</option>
                <option value="under_inspection">قيد الفحص</option>
                <option value="out_of_service">خارج الخدمة</option>
                <option value="retired">متقاعد / مشطوب</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الموقع الحالي</label>
              <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">صاحب العهدة</label>
              <select value={form.custodianId} onChange={(e) => setForm({ ...form, custodianId: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="">غير محدد</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.fullNameAr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ انتهاء الضمان</label>
              <input type="date" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">ملاحظات إدارية ومعلومات الشراء</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ البيانات</button>
          </div>
        </form>
      </Modal>

      {/* Transfer Modal */}
      <Modal open={Boolean(transferTarget)} onClose={() => setTransferTarget(null)} title={`نقل عهدة وموقع: ${transferTarget?.nameAr || ''}`} size="md">
        <form onSubmit={submitTransfer} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">الموقع الجديد *</label>
            <input type="text" required value={transferForm.toLocation} onChange={(e) => setTransferForm({ ...transferForm, toLocation: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">صاحب العهدة الجديد</label>
            <select value={transferForm.toCustodianId} onChange={(e) => setTransferForm({ ...transferForm, toCustodianId: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
              <option value="">إبقاء العهدة الحالية</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.fullNameAr}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">سبب المناقلة</label>
            <input type="text" value={transferForm.reason} onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTransferTarget(null)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#078C8C] text-white">توثيق النقل</button>
          </div>
        </form>
      </Modal>

      <PrintReportModal open={reportOpen} onClose={() => setReportOpen(false)} moduleKey="equipment" canExport={user.role !== 'viewer'} />
    </div>
  );
}
