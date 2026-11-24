import React, { useState } from 'react';
import { FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { downloadProtectedFile } from '../../lib/api';
import type { AuthUser } from '../../shared/types';
import { PrintReportModal } from '../PrintReportModal';

const REPORT_CATALOG = [
  {
    key: 'employees',
    title: 'كشف ملاك موظفي الشعبة',
    desc: 'جدول رسمي بأسماء الموظفين، العناوين الوظيفية، الوحدات، المؤهلات، وحالة الدوام.',
  },
  {
    key: 'equipment',
    title: 'سجل جرد المعدات والأصول',
    desc: 'حصر شامل لجميع الأجهزة المسجلة، الأرقام التسلسلية، العهد، الحالة التشغيلية، والضمانات.',
  },
  {
    key: 'maintenance',
    title: 'تقرير أعمال الصيانة الدورية والعلاجية',
    desc: 'أوامر العمل المفتوحة والمكتملة، الأولويات، مواعيد الإنجاز المتوقعة، والتكاليف المسجلة.',
  },
  {
    key: 'inventory',
    title: 'كشف جرد المخزون والمستهلكات',
    desc: 'الأرصدة المتوفرة حالياً، الحدود الدنيا للتنبيه، مواقع التخزين، وتواريخ الصلاحية.',
  },
  {
    key: 'correspondence',
    title: 'سجل المراسلات الصادرة والواردة',
    desc: 'فهرس الكتب الرسمية والمذكرات الداخلية مع الجهات المرسلة والمستلمة ومواعيد المتابعة.',
  },
  {
    key: 'documents',
    title: 'فهرس أرشيف التقارير والوثائق',
    desc: 'قائمة التقارير الدورية والوثائق الرسمية المعتمدة مع أرقام الإصدارات.',
  },
];

export function ReportsCenterView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const canExport = user.role !== 'viewer';

  const handleDirectDownload = async (moduleKey: string, format: 'xlsx' | 'docx') => {
    setBusyKey(`${moduleKey}-${format}`);
    try {
      const code = `PVT_${moduleKey}_${new Date().toISOString().slice(0, 10)}.${format}`;
      await downloadProtectedFile(`/reports/export/${moduleKey}/${format}`, code);
      onToast(`تم توليد وتنزيل التقرير بصيغة ${format.toUpperCase()} بنجاح.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل تصدير التقرير.', 'err');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">مركز التقارير الرسمية والتصدير</h2>
        <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
          توليد تقارير عربية رسمية منسّقة بالاتجاه من اليمين إلى اليسار (RTL) مع ترويسة الشركة ومربعات الاعتماد بصيغ PDF (طباعة مباشرة) وExcel وWord.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {REPORT_CATALOG.map((rep) => (
          <div
            key={rep.key}
            className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5 flex flex-col justify-between gap-4"
          >
            <div>
              <h3 className="text-base font-bold text-[#102638] dark:text-[#E8EEF3]">{rep.title}</h3>
              <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-1.5 leading-relaxed">{rep.desc}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#DFE6EC] dark:border-[#2C3D4D]">
              <button
                type="button"
                onClick={() => setPreviewKey(rep.key)}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold rounded-md bg-[#102638] hover:bg-[#17445C] text-white whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>معاينة / PDF</span>
              </button>
              {canExport && (
                <>
                  <button
                    type="button"
                    disabled={busyKey === `${rep.key}-xlsx`}
                    onClick={() => handleDirectDownload(rep.key, 'xlsx')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold rounded-md bg-[#078C8C] hover:bg-[#067575] text-white whitespace-nowrap disabled:opacity-60"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Excel</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === `${rep.key}-docx`}
                    onClick={() => handleDirectDownload(rep.key, 'docx')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold rounded-md border border-[#17445C] text-[#17445C] dark:text-teal-300 dark:border-teal-500/60 whitespace-nowrap disabled:opacity-60"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Word</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <PrintReportModal
        open={Boolean(previewKey)}
        onClose={() => setPreviewKey(null)}
        moduleKey={previewKey || 'employees'}
        canExport={canExport}
      />
    </div>
  );
}
