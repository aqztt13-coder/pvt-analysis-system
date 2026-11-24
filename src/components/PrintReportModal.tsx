import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { apiRequest, downloadProtectedFile } from '../lib/api';
import type { SystemSettings } from '../shared/types';
import { Modal } from './Modal';

interface ReportPreviewData {
  titleAr: string;
  subtitleAr: string;
  documentCode: string;
  preparedBy: string;
  periodLabel: string;
  columns: Array<{ key: string; header: string }>;
  rows: Array<Record<string, string | number | null | undefined>>;
  settings: SystemSettings;
}

export function PrintReportModal({
  open,
  onClose,
  moduleKey,
  canExport,
}: {
  open: boolean;
  onClose: () => void;
  moduleKey: string;
  canExport: boolean;
}) {
  const [data, setData] = useState<ReportPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    apiRequest<ReportPreviewData>(`/reports/preview/${moduleKey}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, moduleKey]);

  const handleExport = async (format: 'xlsx' | 'docx') => {
    if (!data) return;
    setExporting(format);
    try {
      await downloadProtectedFile(
        `/reports/export/${moduleKey}/${format}`,
        `${data.documentCode}.${format}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تصدير الملف.');
    } finally {
      setExporting('');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={data ? data.titleAr : 'معاينة التقرير الرسمي'}
      subtitle="نسخة جاهزة للطباعة أو التصدير بصيغة Excel / Word / PDF"
      size="xl"
    >
      {loading && <p className="text-sm text-[#718096] py-8 text-center">جارٍ تجهيز بيانات التقرير...</p>}
      {error && (
        <div className="p-3 mb-4 text-sm text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900 rounded-md">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#DFE6EC] dark:border-[#2C3D4D] no-print">
            <div className="text-xs text-[#718096] dark:text-[#A9B7C4] tabular-nums">
              رقم الوثيقة: <span className="font-mono font-semibold text-[#102638] dark:text-white">{data.documentCode}</span> · السجلات: {data.rows.length}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-semibold rounded-md bg-[#102638] hover:bg-[#17445C] text-white transition-colors whitespace-nowrap"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة / حفظ PDF</span>
              </button>
              {canExport && (
                <>
                  <button
                    type="button"
                    disabled={Boolean(exporting)}
                    onClick={() => handleExport('xlsx')}
                    className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-semibold rounded-md bg-[#078C8C] hover:bg-[#067575] text-white transition-colors whitespace-nowrap disabled:opacity-60"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>{exporting === 'xlsx' ? 'جارٍ التصدير...' : 'تصدير Excel (XLSX)'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(exporting)}
                    onClick={() => handleExport('docx')}
                    className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-semibold rounded-md border border-[#17445C] text-[#17445C] dark:text-teal-300 dark:border-teal-500/60 hover:bg-[#DDF2F0]/40 dark:hover:bg-[#203C50] transition-colors whitespace-nowrap disabled:opacity-60"
                  >
                    <FileText className="w-4 h-4" />
                    <span>{exporting === 'docx' ? 'جارٍ التصدير...' : 'تصدير Word (DOCX)'}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Printable Corporate Document Sheet */}
          <div className="bg-white text-[#233747] border border-[#DFE6EC] rounded-md p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b-2 border-[#102638]">
              <div>
                <p className="text-sm font-bold text-[#102638]">{data.settings.companyNameAr}</p>
                <p className="text-xs font-semibold text-[#078C8C] mt-0.5">{data.settings.divisionNameAr}</p>
                <p className="text-[11px] text-[#718096] mt-0.5" dir="ltr">
                  {data.settings.divisionNameEn}
                </p>
              </div>
              <div className="text-xs text-[#233747] space-y-1 tabular-nums sm:text-left">
                <div>
                  <span className="text-[#718096]">رقم الوثيقة: </span>
                  <span className="font-mono font-semibold" dir="ltr">{data.documentCode}</span>
                </div>
                <div>
                  <span className="text-[#718096]">تاريخ الإصدار: </span>
                  <span className="font-mono">{new Date().toISOString().slice(0, 10)}</span>
                </div>
                <div>
                  <span className="text-[#718096]">معدّ التقرير: </span>
                  <span>{data.preparedBy}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-[#102638]">{data.titleAr}</h3>
              <p className="text-xs text-[#718096] mt-0.5">{data.subtitleAr} — الفترة: {data.periodLabel}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse border border-[#DFE6EC]">
                <thead>
                  <tr className="bg-[#102638] text-white">
                    {data.columns.map((c) => (
                      <th key={c.key} className="px-3 py-2 text-right font-semibold border border-[#203C50]">
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 1 ? 'bg-[#F3F6F9]' : 'bg-white'}>
                      {data.columns.map((c) => (
                        <td key={c.key} className="px-3 py-2 border border-[#DFE6EC] text-right">
                          {row[c.key] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-8 pt-6 text-xs text-[#233747]">
              <div className="space-y-4">
                <p className="font-semibold">إعداد وتدقيق:</p>
                <p className="text-[#718096]">{data.preparedBy}</p>
                <div className="border-b border-dashed border-[#66869A] w-48 pt-4" />
              </div>
              <div className="space-y-4">
                <p className="font-semibold">اعتماد مدير شعبة موائع المكامن:</p>
                <p className="text-[#718096]">الاسم والتوقيع والختم</p>
                <div className="border-b border-dashed border-[#66869A] w-48 pt-4" />
              </div>
            </div>

            <div className="pt-3 border-t border-[#DFE6EC] flex items-center justify-between text-[11px] text-[#718096]">
              <span>{data.settings.reportFooterAr}</span>
              <span className="inline-flex items-center gap-1">
                <Download className="w-3 h-3" />
                إجمالي السجلات: {data.rows.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
