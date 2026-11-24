import type { SystemNotification } from '../shared/types';

export interface AlertDerivationInput {
  pendingLeaves: Array<{ id: number; employeeName: string; startDate: string }>;
  pendingRequests: Array<{ id: number; requestNumber: string; title: string; submissionDate: string }>;
  maintenance: Array<{
    id: number;
    workOrderNo: string;
    equipmentName: string;
    expectedEndDate: string;
    status: string;
  }>;
  calibrations: Array<{
    id: number;
    equipmentName: string;
    certificateNumber: string;
    dueDate: string;
    status: string;
  }>;
  equipment: Array<{
    id: number;
    equipmentCode: string;
    nameAr: string;
    warrantyExpiry: string;
    status: string;
  }>;
  inventory: Array<{
    id: number;
    itemCode: string;
    nameAr: string;
    quantity: number;
    minStock: number;
    expiryDate: string | null;
  }>;
  tasks: Array<{
    id: number;
    title: string;
    assignedTo: string;
    dueDate: string;
    status: string;
  }>;
  correspondence: Array<{
    id: number;
    refNumber: string;
    subject: string;
    dueDate: string;
    status: string;
  }>;
  documents: Array<{
    id: number;
    docNumber: string;
    title: string;
    reviewDueDate: string | null;
    status: string;
  }>;
}

export interface AlertConfig {
  calibrationAlertDays: number;
  warrantyAlertDays: number;
  expiryAlertDays?: number;
}

export function diffDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const to = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 9999;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

export function deriveNotifications(
  input: AlertDerivationInput,
  todayIso: string,
  config: AlertConfig,
  readIds: Set<string> = new Set()
): SystemNotification[] {
  const items: SystemNotification[] = [];
  const expiryDays = config.expiryAlertDays ?? 30;

  // 1. Pending leaves
  for (const leave of input.pendingLeaves) {
    const id = `leave-${leave.id}`;
    items.push({
      id,
      category: 'leave',
      severity: 'warning',
      title: `طلب إجازة بانتظار الاعتماد — ${leave.employeeName}`,
      message: `طلب إجازة يبدأ بتاريخ ${leave.startDate} يحتاج إلى قرار إداري.`,
      targetModule: 'attendance',
      referenceId: String(leave.id),
      dueDate: leave.startDate,
      isRead: readIds.has(id),
      createdAt: todayIso,
    });
  }

  // 2. Pending procurement / admin requests
  for (const req of input.pendingRequests) {
    const id = `req-${req.id}`;
    items.push({
      id,
      category: 'approval',
      severity: 'info',
      title: `طلب إداري/مشتريات قيد المراجعة (${req.requestNumber})`,
      message: req.title,
      targetModule: 'requests',
      referenceId: String(req.id),
      dueDate: req.submissionDate,
      isRead: readIds.has(id),
      createdAt: todayIso,
    });
  }

  // 3. Overdue or upcoming maintenance
  for (const m of input.maintenance) {
    if (m.status === 'completed' || m.status === 'cancelled' || !m.expectedEndDate) continue;
    const days = diffDays(todayIso, m.expectedEndDate);
    if (days < 0) {
      const id = `maint-overdue-${m.id}`;
      items.push({
        id,
        category: 'maintenance',
        severity: 'critical',
        title: `صيانة متأخرة — ${m.equipmentName}`,
        message: `أمر العمل ${m.workOrderNo} تجاوز موعد الإنجاز المتوقع (${m.expectedEndDate}) بـ ${Math.abs(days)} يوم.`,
        targetModule: 'maintenance',
        referenceId: String(m.id),
        dueDate: m.expectedEndDate,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    } else if (days <= 7) {
      const id = `maint-due-${m.id}`;
      items.push({
        id,
        category: 'maintenance',
        severity: 'warning',
        title: `موعد صيانة قريب — ${m.equipmentName}`,
        message: `أمر العمل ${m.workOrderNo} مستحق خلال ${days} يوم (${m.expectedEndDate}).`,
        targetModule: 'maintenance',
        referenceId: String(m.id),
        dueDate: m.expectedEndDate,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    }
  }

  // 4. Calibration due / overdue
  for (const c of input.calibrations) {
    if (!c.dueDate) continue;
    const days = diffDays(todayIso, c.dueDate);
    if (days < 0) {
      const id = `cal-overdue-${c.id}`;
      items.push({
        id,
        category: 'calibration',
        severity: 'critical',
        title: `معايرة منتهية الصلاحية — ${c.equipmentName}`,
        message: `الشهادة ${c.certificateNumber} تجاوزت تاريخ الاستحقاق (${c.dueDate}) بـ ${Math.abs(days)} يوم.`,
        targetModule: 'maintenance',
        referenceId: String(c.id),
        dueDate: c.dueDate,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    } else if (days <= config.calibrationAlertDays) {
      const id = `cal-due-${c.id}`;
      items.push({
        id,
        category: 'calibration',
        severity: 'warning',
        title: `استحقاق معايرة قريب — ${c.equipmentName}`,
        message: `موعد المعايرة القادمة بتاريخ ${c.dueDate} (متبقي ${days} يوم).`,
        targetModule: 'maintenance',
        referenceId: String(c.id),
        dueDate: c.dueDate,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    }
  }

  // 5. Inventory low stock & expiry
  for (const item of input.inventory) {
    if (item.quantity <= item.minStock) {
      const id = `inv-low-${item.id}`;
      items.push({
        id,
        category: 'inventory',
        severity: item.quantity === 0 ? 'critical' : 'warning',
        title: `انخفاض المخزون — ${item.nameAr}`,
        message: `الرصيد الحالي (${item.quantity}) وصل أو قلّ عن الحد الأدنى (${item.minStock}) للصنف ${item.itemCode}.`,
        targetModule: 'inventory',
        referenceId: String(item.id),
        dueDate: null,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    }
    if (item.expiryDate) {
      const days = diffDays(todayIso, item.expiryDate);
      if (days <= expiryDays) {
        const id = `inv-exp-${item.id}`;
        items.push({
          id,
          category: 'inventory',
          severity: days < 0 ? 'critical' : 'warning',
          title:
            days < 0
              ? `انتهاء صلاحية مادة مخزنية — ${item.nameAr}`
              : `قرب انتهاء صلاحية مادة — ${item.nameAr}`,
          message:
            days < 0
              ? `انتهت صلاحية الصنف ${item.itemCode} بتاريخ ${item.expiryDate}.`
              : `تنتهي صلاحية الصنف ${item.itemCode} بتاريخ ${item.expiryDate} (متبقي ${days} يوم).`,
          targetModule: 'inventory',
          referenceId: String(item.id),
          dueDate: item.expiryDate,
          isRead: readIds.has(id),
          createdAt: todayIso,
        });
      }
    }
  }

  // 6. Expiring equipment warranties
  for (const eq of input.equipment) {
    if (eq.status === 'retired' || !eq.warrantyExpiry) continue;
    const days = diffDays(todayIso, eq.warrantyExpiry);
    if (days >= 0 && days <= config.warrantyAlertDays) {
      const id = `warranty-${eq.id}`;
      items.push({
        id,
        category: 'warranty',
        severity: 'info',
        title: `قرب انتهاء ضمان جهاز — ${eq.nameAr}`,
        message: `ينتهي ضمان الجهاز ${eq.equipmentCode} بتاريخ ${eq.warrantyExpiry} (متبقي ${days} يوم).`,
        targetModule: 'equipment',
        referenceId: String(eq.id),
        dueDate: eq.warrantyExpiry,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    }
  }

  // 7. Overdue tasks
  for (const t of input.tasks) {
    if (t.status === 'completed' || !t.dueDate) continue;
    const days = diffDays(todayIso, t.dueDate);
    if (days < 0) {
      const id = `task-overdue-${t.id}`;
      items.push({
        id,
        category: 'task',
        severity: 'critical',
        title: `مهمة متأخرة — ${t.title}`,
        message: `المكلف: ${t.assignedTo} — تجاوزت الموعد النهائي (${t.dueDate}).`,
        targetModule: 'meetings',
        referenceId: String(t.id),
        dueDate: t.dueDate,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    } else if (days <= 3) {
      const id = `task-soon-${t.id}`;
      items.push({
        id,
        category: 'task',
        severity: 'warning',
        title: `موعد تسليم مهمة قريب — ${t.title}`,
        message: `المكلف: ${t.assignedTo} — تاريخ الاستحقاق ${t.dueDate}.`,
        targetModule: 'meetings',
        referenceId: String(t.id),
        dueDate: t.dueDate,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    }
  }

  // 8. Overdue correspondence
  for (const corr of input.correspondence) {
    if (corr.status === 'completed' || corr.status === 'archived' || !corr.dueDate) continue;
    const days = diffDays(todayIso, corr.dueDate);
    if (days < 0) {
      const id = `corr-overdue-${corr.id}`;
      items.push({
        id,
        category: 'correspondence',
        severity: 'critical',
        title: `مراسلة متأخرة المتابعة (${corr.refNumber})`,
        message: `${corr.subject} — تجاوزت موعد الرد/المتابعة (${corr.dueDate}).`,
        targetModule: 'correspondence',
        referenceId: String(corr.id),
        dueDate: corr.dueDate,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    }
  }

  // 9. Document review dates
  for (const doc of input.documents) {
    if (doc.status === 'archived' || !doc.reviewDueDate) continue;
    const days = diffDays(todayIso, doc.reviewDueDate);
    if (days <= 14) {
      const id = `doc-review-${doc.id}`;
      items.push({
        id,
        category: 'document',
        severity: days < 0 ? 'warning' : 'info',
        title: `موعد مراجعة وثيقة (${doc.docNumber})`,
        message: `${doc.title} — تاريخ المراجعة المجدول: ${doc.reviewDueDate}.`,
        targetModule: 'documents',
        referenceId: String(doc.id),
        dueDate: doc.reviewDueDate,
        isRead: readIds.has(id),
        createdAt: todayIso,
      });
    }
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export function computeStockAdjustment(
  currentQty: number,
  txType: 'receipt' | 'issue' | 'adjustment',
  amount: number
): { valid: boolean; quantityDelta?: number; newBalance?: number; error?: string } {
  if (!Number.isFinite(amount)) {
    return { valid: false, error: 'الكمية المدخلة غير صالحة.' };
  }
  if (txType === 'receipt') {
    if (amount <= 0) {
      return { valid: false, error: 'يجب أن تكون كمية الاستلام أكبر من صفر.' };
    }
    return { valid: true, quantityDelta: amount, newBalance: currentQty + amount };
  }
  if (txType === 'issue') {
    if (amount <= 0) {
      return { valid: false, error: 'يجب أن تكون كمية الصرف أكبر من صفر.' };
    }
    if (amount > currentQty) {
      return {
        valid: false,
        error: `الكمية المطلوب صرفها (${amount}) تتجاوز الرصيد المتوفر حالياً (${currentQty}).`,
      };
    }
    return { valid: true, quantityDelta: -amount, newBalance: currentQty - amount };
  }
  // adjustment sets exact new count (must be >= 0)
  if (amount < 0) {
    return { valid: false, error: 'لا يمكن أن يكون رصيد الجرد المعدل أقل من صفر.' };
  }
  return { valid: true, quantityDelta: amount - currentQty, newBalance: amount };
}
