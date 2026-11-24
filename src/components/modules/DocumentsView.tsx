import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, Eye, FileSpreadsheet, Plus, Upload } from 'lucide-react';
import {
  apiRequest,
  downloadProtectedFile,
  fetchProtectedPreviewUrl,
  uploadFileToServer,
} from '../../lib/api';
import type {
  AuthUser,
  DocumentRecord,
  Employee,
  EquipmentItem,
  SystemSettings,
} from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { PrintReportModal } from '../PrintReportModal';
import { StatusBadge } from '../StatusBadge';

export function DocumentsView({
  user,
  settings,
  onToast,
}: {
  user: AuthUser;
  settings: SystemSettings;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<DocumentRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [catFilter, setCatFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ title: string; url: string; mime: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    docNumber: '',
    title: '',
    category: settings.documentCategories[0] || 'التقارير الشهرية',
    referenceNumber: '',
    creationDate: new Date().toISOString().slice(0, 10),
    relatedEmployeeId: '',
    relatedEquipmentId: '',
    description: '',
    tags: '',
    reviewDueDate: '',
  });

  const canWrite = user.role === 'manager' || user.role === 'engineer';
  const isManager = user.role === 'manager';

  const load = async () => {
    setLoading(true);
    try {
      const [docsRes, empRes, eqRes] = await Promise.all([
        apiRequest<{ items: DocumentRecord[] }>('/documents'),
        apiRequest<{ items: Employee[] }>('/employees'),
        apiRequest<{ items: EquipmentItem[] }>('/equipment'),
      ]);
      setItems(docsRes.items);
      setEmployees(empRes.items);
      setEquipment(eqRes.items);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحميل أرشيف الوثائق.', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let fileId: number | null = null;
      if (file) {
        const up = await uploadFileToServer(file, 'documents');
        fileId = up.id;
      }
      await apiRequest('/documents', {
        method: 'POST',
        body: {
          ...form,
          relatedEmployeeId: form.relatedEmployeeId ? Number(form.relatedEmployeeId) : null,
          relatedEquipmentId: form.relatedEquipmentId ? Number(form.relatedEquipmentId) : null,
          fileId,
        },
      });
      onToast('تمت أرشفة الوثيقة وحفظ المرفق محلياً بنجاح.');
      setModalOpen(false);
      setFile(null);
      setForm((f) => ({ ...f, docNumber: '', title: '', referenceNumber: '', description: '', tags: '' }));
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل أرشفة الوثيقة.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const approveDoc = async (doc: DocumentRecord) => {
    try {
      await apiRequest(`/documents/${doc.id}/status`, {
        method: 'PATCH',
        body: { status: 'approved', bumpRevision: true },
      });
      onToast(`تم اعتماد الوثيقة ${doc.docNumber}.`);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر اعتماد الوثيقة.', 'err');
    }
  };

  const openPreview = async (doc: DocumentRecord) => {
    if (!doc.fileId) return;
    try {
      const url = await fetchProtectedPreviewUrl(doc.fileId);
      setPreviewDoc({ title: doc.title, url, mime: doc.fileMime || 'application/octet-stream' });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر معاينة الملف.', 'err');
    }
  };

  const closePreview = () => {
    if (previewDoc?.url) URL.revokeObjectURL(previewDoc.url);
    setPreviewDoc(null);
  };

  const visible = catFilter === 'all' ? items : items.filter((d) => d.category === catFilter);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">أرشيف التقارير والوثائق</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            حفظ وتصنيف ومراجعة جميع تقارير الشعبة محلياً عبر مسارات محمية بالصلاحيات مع دعم PDF وDOCX وXLSX والصور.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#078C8C]" />
            <span>تصدير فهرس الأرشيف</span>
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>رفع وأرشفة وثيقة</span>
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
          searchPlaceholder="بحث برقم الوثيقة، العنوان، الوسوم، أو المعدّ..."
          searchFilter={(r, q) =>
            `${r.docNumber} ${r.title} ${r.category} ${r.author} ${r.tags} ${r.referenceNumber}`.toLowerCase().includes(q)
          }
          toolbarExtra={
            <select
              aria-label="تصفية حسب التصنيف"
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
            >
              <option value="all">جميع التصنيفات ({items.length})</option>
              {settings.documentCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          }
          columns={[
            {
              key: 'no',
              header: 'رقم الوثيقة',
              sortable: true,
              sortValue: (r) => r.docNumber,
              render: (r) => (
                <div>
                  <p className="font-mono text-xs font-semibold text-[#078C8C]" dir="ltr">{r.docNumber}</p>
                  <p className="text-[11px] text-[#718096]">إصدار {r.revisionNo}</p>
                </div>
              ),
            },
            {
              key: 'title',
              header: 'عنوان الوثيقة والتصنيف',
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs text-[#102638] dark:text-[#E8EEF3]">{r.title}</p>
                  <p className="text-[11px] text-[#718096]">
                    {r.category} {r.relatedEquipmentName ? `· جهاز: ${r.relatedEquipmentName}` : ''}
                  </p>
                </div>
              ),
            },
            { key: 'author', header: 'المعدّ والتاريخ', mobileHidden: true, render: (r) => <div className="text-xs"><p>{r.author}</p><p className="font-mono text-[11px] text-[#718096]">{r.creationDate}</p></div> },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: 'الملف والاعتماد',
              render: (r) => (
                <div className="flex items-center gap-1.5">
                  {r.fileId && (
                    <>
                      {(r.fileMime?.startsWith('image/') || r.fileMime === 'application/pdf' || r.fileMime === 'text/plain') && (
                        <button
                          type="button"
                          onClick={() => openPreview(r)}
                          aria-label={`معاينة ${r.title}`}
                          className="p-2 rounded hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] text-[#17445C] dark:text-teal-300"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => downloadProtectedFile(`/files/${r.fileId}/download`, r.fileName || `${r.docNumber}.bin`)}
                        aria-label={`تنزيل ${r.title}`}
                        className="p-2 rounded hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] text-[#078C8C]"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {isManager && r.status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => approveDoc(r)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-700 hover:bg-emerald-800 text-white"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>اعتماد</span>
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Upload Document Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="أرشفة وثيقة أو تقرير جديد" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">عنوان الوثيقة *</label>
              <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التصنيف *</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                {settings.documentCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الرقم المرجعي (اختياري)</label>
              <input type="text" dir="ltr" value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ الإنشاء</label>
              <input type="date" value={form.creationDate} onChange={(e) => setForm({ ...form, creationDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">موعد المراجعة الدورية</label>
              <input type="date" value={form.reviewDueDate} onChange={(e) => setForm({ ...form, reviewDueDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">ربط بموظف (اختياري)</label>
              <select value={form.relatedEmployeeId} onChange={(e) => setForm({ ...form, relatedEmployeeId: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="">— بدون ربط —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.fullNameAr}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">ربط بجهاز (اختياري)</label>
              <select value={form.relatedEquipmentId} onChange={(e) => setForm({ ...form, relatedEquipmentId: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="">— بدون ربط —</option>
                {equipment.map((q) => <option key={q.id} value={q.id}>{q.nameAr}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">وصف مختصر</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="p-4 rounded-md border border-dashed border-[#66869A] bg-[#F3F6F9] dark:bg-[#101A24]">
            <label className="flex items-center gap-2 text-xs font-semibold mb-2">
              <Upload className="w-4 h-4 text-[#078C8C]" />
              <span>إرفاق ملف (PDF, DOCX, XLSX, PNG, JPG, TXT — بحد أقصى 15MB)</span>
            </label>
            <input type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs w-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white disabled:opacity-60">
              {saving ? 'جارٍ الرفع والحفظ...' : 'حفظ بالأرشيف'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Safe Preview Modal */}
      <Modal open={Boolean(previewDoc)} onClose={closePreview} title={previewDoc?.title || 'معاينة الملف'} size="xl">
        {previewDoc && (
          <div className="min-h-[60vh] flex items-center justify-center bg-[#F3F6F9] dark:bg-[#101A24] rounded-md overflow-hidden">
            {previewDoc.mime.startsWith('image/') ? (
              <img src={previewDoc.url} alt={previewDoc.title} className="max-h-[70vh] object-contain" />
            ) : (
              <iframe title={previewDoc.title} src={previewDoc.url} className="w-full h-[70vh] border-0" />
            )}
          </div>
        )}
      </Modal>

      <PrintReportModal open={reportOpen} onClose={() => setReportOpen(false)} moduleKey="documents" canExport={user.role !== 'viewer'} />
    </div>
  );
}
