import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Plus, ShieldAlert } from 'lucide-react';
import { apiRequest, downloadProtectedFile, uploadFileToServer } from '../../lib/api';
import type {
  AuthUser,
  CalibrationRecord,
  EquipmentItem,
  MaintenanceRecord,
} from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { PrintReportModal } from '../PrintReportModal';
import { StatusBadge } from '../StatusBadge';

export function MaintenanceCalView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<'maintenance' | 'calibrations'>('maintenance');
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [calibrations, setCalibrations] = useState<CalibrationRecord[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [maintModal, setMaintModal] = useState(false);
  const [calModal, setCalModal] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);

  const [maintForm, setMaintForm] = useState({
    equipmentId: '',
    maintenanceType: 'corrective',
    assignedTo: '',
    priority: 'medium',
    startDate: new Date().toISOString().slice(0, 10),
    expectedEndDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    description: '',
    spareParts: '',
    costAmount: '',
  });
  const [calForm, setCalForm] = useState({
    equipmentId: '',
    calibrationDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    provider: '',
    certificateNumber: '',
    responsiblePerson: user.fullNameAr,
    notes: '',
  });

  const canWrite = user.role === 'manager' || user.role === 'engineer';
  const today = new Date().toISOString().slice(0, 10);

  const load = async () => {
    setLoading(true);
    try {
      const [mRes, eqRes] = await Promise.all([
        apiRequest<{ maintenance: MaintenanceRecord[]; calibrations: CalibrationRecord[] }>('/maintenance'),
        apiRequest<{ items: EquipmentItem[] }>('/equipment'),
      ]);
      setMaintenance(mRes.maintenance);
      setCalibrations(mRes.calibrations);
      setEquipment(eqRes.items);
      if (eqRes.items.length > 0) {
        setMaintForm((f) => ({ ...f, equipmentId: f.equipmentId || String(eqRes.items[0].id) }));
        setCalForm((f) => ({ ...f, equipmentId: f.equipmentId || String(eqRes.items[0].id) }));
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحميل سجلات الصيانة والمعايرة.', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submitMaint = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/maintenance', {
        method: 'POST',
        body: { ...maintForm, equipmentId: Number(maintForm.equipmentId) },
      });
      onToast('تم إنشاء أمر عمل الصيانة بنجاح.');
      setMaintModal(false);
      setMaintForm((f) => ({ ...f, description: '', spareParts: '', costAmount: '' }));
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل فتح أمر الصيانة.', 'err');
    }
  };

  const completeMaint = async (m: MaintenanceRecord) => {
    try {
      await apiRequest(`/maintenance/${m.id}`, {
        method: 'PATCH',
        body: { status: 'completed', actualEndDate: today },
      });
      onToast(`تم إغلاق أمر العمل ${m.workOrderNo} وإعادة الجهاز للخدمة.`);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحديث أمر الصيانة.', 'err');
    }
  };

  const submitCal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let fileId: number | null = null;
      if (certFile) {
        const uploaded = await uploadFileToServer(certFile, 'calibrations');
        fileId = uploaded.id;
      }
      await apiRequest('/calibrations', {
        method: 'POST',
        body: { ...calForm, equipmentId: Number(calForm.equipmentId), fileId },
      });
      onToast('تم توثيق سجل المعايرة والشهادة بنجاح.');
      setCalModal(false);
      setCertFile(null);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر حفظ سجل المعايرة.', 'err');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">إدارة الصيانة وسجلات المعايرة والفحص</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            تتبع أوامر الصيانة الوقائية والعلاجية ومواعيد تجديد شهادات المعايرة الإدارية والتنبيه التلقائي عن التأخيرات.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#078C8C]" />
            <span>تصدير تقرير الصيانة</span>
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => setMaintModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>أمر صيانة جديد</span>
              </button>
              <button
                type="button"
                onClick={() => setCalModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#17445C] text-[#17445C] dark:text-teal-300 dark:border-teal-500/60 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>تسجيل معايرة</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setTab('maintenance')}
          className={`px-4 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
            tab === 'maintenance' ? 'bg-[#102638] dark:bg-[#078C8C] text-white' : 'text-[#718096] dark:text-[#A9B7C4]'
          }`}
        >
          أوامر الصيانة ({maintenance.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('calibrations')}
          className={`px-4 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
            tab === 'calibrations' ? 'bg-[#102638] dark:bg-[#078C8C] text-white' : 'text-[#718096] dark:text-[#A9B7C4]'
          }`}
        >
          سجل المعايرة والفحص ({calibrations.length})
        </button>
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : tab === 'maintenance' ? (
        <DataTable
          rows={maintenance}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث برقم أمر العمل أو اسم الجهاز أو الوصف..."
          searchFilter={(r, q) => `${r.workOrderNo} ${r.equipmentName} ${r.description} ${r.assignedTo}`.toLowerCase().includes(q)}
          columns={[
            {
              key: 'wo',
              header: 'أمر العمل',
              render: (r) => (
                <div>
                  <p className="font-mono text-xs font-semibold text-[#078C8C]" dir="ltr">{r.workOrderNo}</p>
                  <p className="text-[11px] text-[#718096]">
                    {r.maintenanceType === 'preventive' ? 'وقائية' : r.maintenanceType === 'breakdown' ? 'عطل طارئ' : 'علاجية'}
                  </p>
                </div>
              ),
            },
            {
              key: 'eq',
              header: 'الجهاز والوصف',
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs">{r.equipmentName}</p>
                  <p className="text-[11px] text-[#718096] max-w-xs truncate">{r.description}</p>
                </div>
              ),
            },
            { key: 'assigned', header: 'المنفذ', mobileHidden: true, render: (r) => <span className="text-xs">{r.assignedTo || '—'}</span> },
            { key: 'priority', header: 'الأولوية', render: (r) => <StatusBadge status={r.priority} /> },
            {
              key: 'due',
              header: 'الموعد المتوقع',
              render: (r) => {
                const overdue = r.status !== 'completed' && r.status !== 'cancelled' && r.expectedEndDate < today;
                return (
                  <div className="text-xs font-mono tabular-nums">
                    <span className={overdue ? 'text-red-700 dark:text-red-400 font-bold' : ''}>{r.expectedEndDate}</span>
                    {overdue && (
                      <p className="text-[11px] font-sans text-red-700 dark:text-red-400 inline-flex items-center gap-1 mr-1">
                        <ShieldAlert className="w-3 h-3" /> متأخر
                      </p>
                    )}
                  </div>
                );
              },
            },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'act',
              header: 'إجراء',
              render: (r) =>
                canWrite && r.status !== 'completed' && r.status !== 'cancelled' ? (
                  <button
                    type="button"
                    onClick={() => completeMaint(r)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-700 hover:bg-emerald-800 text-white whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>إتمام</span>
                  </button>
                ) : (
                  <span className="text-xs text-[#718096]">{r.actualEndDate || '—'}</span>
                ),
            },
          ]}
        />
      ) : (
        <DataTable
          rows={calibrations}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث باسم الجهاز أو رقم الشهادة أو جهة المعايرة..."
          searchFilter={(r, q) => `${r.equipmentName} ${r.certificateNumber} ${r.provider}`.toLowerCase().includes(q)}
          columns={[
            {
              key: 'eq',
              header: 'الجهاز',
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs">{r.equipmentName}</p>
                  <p className="text-[11px] font-mono text-[#718096]" dir="ltr">{r.equipmentCode}</p>
                </div>
              ),
            },
            { key: 'cert', header: 'رقم الشهادة والجهة', render: (r) => <div className="text-xs"><p className="font-mono font-semibold" dir="ltr">{r.certificateNumber}</p><p className="text-[11px] text-[#718096]">{r.provider}</p></div> },
            { key: 'calDate', header: 'تاريخ المعايرة', render: (r) => <span className="font-mono text-xs tabular-nums">{r.calibrationDate}</span> },
            { key: 'dueDate', header: 'تاريخ الاستحقاق', render: (r) => <span className={`font-mono text-xs tabular-nums font-semibold ${r.dueDate < today ? 'text-red-700 dark:text-red-400' : ''}`}>{r.dueDate}</span> },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.dueDate < today ? 'overdue' : r.status} /> },
            {
              key: 'file',
              header: 'الشهادة المرفقة',
              render: (r) =>
                r.fileId ? (
                  <button
                    type="button"
                    onClick={() => downloadProtectedFile(`/files/${r.fileId}/download`, r.fileName || 'certificate.pdf')}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#078C8C] hover:underline"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تنزيل</span>
                  </button>
                ) : (
                  <span className="text-xs text-[#718096]">بدون مرفق</span>
                ),
            },
          ]}
        />
      )}

      {/* New Maintenance Modal */}
      <Modal open={maintModal} onClose={() => setMaintModal(false)} title="فتح أمر عمل صيانة جديد" size="lg">
        <form onSubmit={submitMaint} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">الجهاز *</label>
              <select value={maintForm.equipmentId} onChange={(e) => setMaintForm({ ...maintForm, equipmentId: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                {equipment.map((q) => <option key={q.id} value={q.id}>{q.nameAr} ({q.equipmentCode})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">نوع الصيانة</label>
              <select value={maintForm.maintenanceType} onChange={(e) => setMaintForm({ ...maintForm, maintenanceType: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="preventive">صيانة وقائية مجدولة</option>
                <option value="corrective">صيانة علاجية</option>
                <option value="breakdown">بلاغ عطل طارئ</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الجهة / الفني المكلف</label>
              <input type="text" value={maintForm.assignedTo} onChange={(e) => setMaintForm({ ...maintForm, assignedTo: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الأولوية</label>
              <select value={maintForm.priority} onChange={(e) => setMaintForm({ ...maintForm, priority: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="critical">حرجة</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ البدء *</label>
              <input type="date" required value={maintForm.startDate} onChange={(e) => setMaintForm({ ...maintForm, startDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ الإنجاز المتوقع *</label>
              <input type="date" required value={maintForm.expectedEndDate} onChange={(e) => setMaintForm({ ...maintForm, expectedEndDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">وصف العمل أو العطل *</label>
            <textarea rows={2} required value={maintForm.description} onChange={(e) => setMaintForm({ ...maintForm, description: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">قطع الغيار المستخدمة</label>
              <input type="text" value={maintForm.spareParts} onChange={(e) => setMaintForm({ ...maintForm, spareParts: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التكلفة التقديرية (اختياري)</label>
              <input type="number" min={0} value={maintForm.costAmount} onChange={(e) => setMaintForm({ ...maintForm, costAmount: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMaintModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ أمر العمل</button>
          </div>
        </form>
      </Modal>

      {/* New Calibration Modal */}
      <Modal open={calModal} onClose={() => setCalModal(false)} title="توثيق شهادة معايرة وفحص جهاز" size="lg">
        <form onSubmit={submitCal} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">الجهاز *</label>
              <select value={calForm.equipmentId} onChange={(e) => setCalForm({ ...calForm, equipmentId: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                {equipment.map((q) => <option key={q.id} value={q.id}>{q.nameAr} ({q.equipmentCode})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">رقم الشهادة *</label>
              <input type="text" dir="ltr" required value={calForm.certificateNumber} onChange={(e) => setCalForm({ ...calForm, certificateNumber: e.target.value })} className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ المعايرة *</label>
              <input type="date" required value={calForm.calibrationDate} onChange={(e) => setCalForm({ ...calForm, calibrationDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ استحقاق المعايرة القادمة *</label>
              <input type="date" required value={calForm.dueDate} onChange={(e) => setCalForm({ ...calForm, dueDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">الجهة المانحة للشهادة *</label>
              <input type="text" required value={calForm.provider} onChange={(e) => setCalForm({ ...calForm, provider: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">إرفاق نسخة الشهادة (PDF / صورة)</label>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(e) => setCertFile(e.target.files?.[0] || null)} className="w-full text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCalModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#078C8C] text-white">حفظ الشهادة</button>
          </div>
        </form>
      </Modal>

      <PrintReportModal open={reportOpen} onClose={() => setReportOpen(false)} moduleKey="maintenance" canExport={user.role !== 'viewer'} />
    </div>
  );
}
