import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Info,
  Wrench,
  XCircle,
} from 'lucide-react';

interface StatusMeta {
  label: string;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  Icon: React.ComponentType<{ className?: string }>;
}

const STATUS_MAP: Record<string, StatusMeta> = {
  // Employees
  active: { label: 'على رأس العمل', tone: 'green', Icon: CheckCircle2 },
  on_leave: { label: 'في إجازة', tone: 'amber', Icon: Clock },
  seconded: { label: 'منسّب / منتدب', tone: 'blue', Icon: Info },
  suspended: { label: 'موقوف مؤقتاً', tone: 'red', Icon: XCircle },
  retired: { label: 'متقاعد / مستبعد', tone: 'slate', Icon: Archive },

  // Attendance
  present: { label: 'حاضر', tone: 'green', Icon: CheckCircle2 },
  absent: { label: 'غائب', tone: 'red', Icon: XCircle },
  late: { label: 'متأخر', tone: 'amber', Icon: Clock },
  mission: { label: 'إيفاد / واجب', tone: 'blue', Icon: Info },
  holiday: { label: 'عطلة رسمية', tone: 'slate', Icon: Info },

  // Equipment
  operational: { label: 'قيد التشغيل', tone: 'green', Icon: CheckCircle2 },
  under_maintenance: { label: 'قيد الصيانة', tone: 'amber', Icon: Wrench },
  under_inspection: { label: 'قيد الفحص', tone: 'blue', Icon: Info },
  out_of_service: { label: 'خارج الخدمة', tone: 'red', Icon: AlertCircle },

  // Maintenance / Tasks / Requests / Correspondence / Leaves
  scheduled: { label: 'مجدول', tone: 'blue', Icon: Clock },
  open: { label: 'مفتوح', tone: 'blue', Icon: Info },
  pending: { label: 'قيد الانتظار', tone: 'amber', Icon: Clock },
  submitted: { label: 'مقدّم للاعتماد', tone: 'amber', Icon: Clock },
  under_review: { label: 'قيد المراجعة', tone: 'amber', Icon: Clock },
  in_progress: { label: 'قيد التنفيذ', tone: 'blue', Icon: Wrench },
  approved: { label: 'معتمد', tone: 'green', Icon: CheckCircle2 },
  completed: { label: 'مكتمل', tone: 'green', Icon: CheckCircle2 },
  closed: { label: 'مغلق', tone: 'green', Icon: CheckCircle2 },
  rejected: { label: 'مرفوض', tone: 'red', Icon: XCircle },
  cancelled: { label: 'ملغى', tone: 'slate', Icon: XCircle },
  draft: { label: 'مسودة', tone: 'slate', Icon: Info },
  archived: { label: 'مؤرشف', tone: 'slate', Icon: Archive },

  // Calibration
  valid: { label: 'سارية المفعول', tone: 'green', Icon: CheckCircle2 },
  due_soon: { label: 'قريبة الاستحقاق', tone: 'amber', Icon: AlertTriangle },
  overdue: { label: 'متأخرة / منتهية', tone: 'red', Icon: AlertCircle },
  failed: { label: 'غير مطابقة', tone: 'red', Icon: XCircle },

  // Training
  planned: { label: 'مخطط لها', tone: 'slate', Icon: Clock },
  enrolled: { label: 'مسجّل / قيد التدريب', tone: 'blue', Icon: Info },

  // Priority & Severity
  low: { label: 'منخفضة', tone: 'slate', Icon: Info },
  medium: { label: 'متوسطة', tone: 'blue', Icon: Info },
  high: { label: 'عالية', tone: 'amber', Icon: AlertTriangle },
  urgent: { label: 'عاجلة', tone: 'red', Icon: AlertCircle },
  critical: { label: 'حرجة', tone: 'red', Icon: AlertCircle },
  warning: { label: 'تنبيه', tone: 'amber', Icon: AlertTriangle },
  info: { label: 'إشعار', tone: 'blue', Icon: Info },
};

const TONE_CLASSES: Record<StatusMeta['tone'], string> = {
  green: 'text-emerald-700 dark:text-emerald-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-red-700 dark:text-red-400',
  blue: 'text-[#078C8C] dark:text-teal-300',
  slate: 'text-[#66869A] dark:text-[#A9B7C4]',
};

export function StatusBadge({
  status,
  customLabel,
}: {
  status: string;
  customLabel?: string;
}) {
  const meta = STATUS_MAP[status] || {
    label: customLabel || status,
    tone: 'slate' as const,
    Icon: Info,
  };
  const Icon = meta.Icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[meta.tone]}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{customLabel || meta.label}</span>
    </span>
  );
}
