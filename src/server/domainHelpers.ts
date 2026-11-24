/**
 * Pure domain calculation and validation utilities for:
 * - Employee Leave Management (date validation, duration calculation, overlap detection)
 * - Chemical Materials Inventory (container volume math, unit conversions, stock ledger rules)
 */

export const OFFICIAL_DIVISION_NAME_AR = 'شعبة الموائع المكمنية - قسم المختبرات والسيطرة النوعية';
export const CHEMICAL_CATEGORY_AR = 'المواد الكيمياوية';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function calculateLeaveDuration(
  startDate: string,
  endDate: string
): { valid: boolean; days?: number; error?: string } {
  const s = (startDate || '').trim();
  const e = (endDate || '').trim();
  if (!isValidIsoDate(s) || !isValidIsoDate(e)) {
    return { valid: false, error: 'تاريخ بداية أو نهاية الإجازة غير صالح.' };
  }
  const startMs = Date.parse(`${s}T00:00:00Z`);
  const endMs = Date.parse(`${e}T00:00:00Z`);
  if (endMs < startMs) {
    return { valid: false, error: 'لا يمكن أن يكون تاريخ انتهاء الإجازة قبل تاريخ البدء.' };
  }
  const days = Math.round((endMs - startMs) / 86400000) + 1;
  return { valid: true, days };
}

export interface LeaveOverlapCandidate {
  id: number;
  employeeId: number;
  startDate: string;
  endDate: string;
  status: string;
}

export function findConflictingLeave(
  existingLeaves: LeaveOverlapCandidate[],
  employeeId: number,
  startDate: string,
  endDate: string,
  excludeId?: number
): LeaveOverlapCandidate | null {
  for (const l of existingLeaves) {
    if (excludeId && l.id === excludeId) continue;
    if (l.employeeId !== employeeId) continue;
    if (l.status !== 'pending' && l.status !== 'approved') continue;
    // Closed intervals [startDate, endDate] overlap iff startA <= endB && startB <= endA
    if (startDate <= l.endDate && l.startDate <= endDate) {
      return l;
    }
  }
  return null;
}

export function normalizeVolumeToLiters(volume: number, unit: string): number | null {
  if (!Number.isFinite(volume) || volume < 0) return null;
  const u = (unit || '').trim().toLowerCase();
  if (u === 'l' || u === 'liter' || u === 'liters' || u === 'لتر') {
    return Number(volume.toFixed(4));
  }
  if (u === 'ml' || u === 'milliliter' || u === 'milliliters' || u === 'مل' || u === 'مللتر') {
    return Number((volume / 1000).toFixed(4));
  }
  return null;
}

export function computeTotalChemicalVolume(
  containersCount: number,
  containerCapacity: number | null | undefined,
  unit: string
): {
  totalVolume: number;
  totalLiters: number | null;
  displayLabel: string;
} {
  const safeContainers = Number.isFinite(containersCount) && containersCount >= 0 ? containersCount : 0;
  const safeCapacity =
    containerCapacity !== null && containerCapacity !== undefined && Number.isFinite(containerCapacity) && containerCapacity > 0
      ? containerCapacity
      : 0;

  const totalVolume = Number((safeContainers * safeCapacity).toFixed(4));
  const totalLiters = normalizeVolumeToLiters(totalVolume, unit);

  const unitLabel = formatVolumeUnitAr(unit);
  let displayLabel = `${totalVolume} ${unitLabel}`;
  if (
    totalLiters !== null &&
    ['ml', 'milliliter', 'milliliters', 'مل', 'مللتر'].includes((unit || '').trim().toLowerCase()) &&
    totalVolume >= 1000
  ) {
    displayLabel = `${totalVolume} ${unitLabel} (${totalLiters} لتر)`;
  }

  return { totalVolume, totalLiters, displayLabel };
}

export function formatVolumeUnitAr(unit: string): string {
  const u = (unit || '').trim().toLowerCase();
  if (u === 'l' || u === 'liter' || u === 'liters' || u === 'لتر') return 'لتر';
  if (u === 'ml' || u === 'milliliter' || u === 'milliliters' || u === 'مل' || u === 'مللتر') return 'مل';
  return unit || 'وحدة';
}

export type InventoryTxKind = 'receipt' | 'issue' | 'adjustment' | 'transfer';

export function computeInventoryTransactionMath(params: {
  currentQty: number;
  containerCapacity: number | null;
  volumeUnit: string;
  txType: InventoryTxKind;
  amount: number;
  newLocation?: string;
}): {
  valid: boolean;
  quantityDelta?: number;
  newBalance?: number;
  volumeDelta?: number;
  totalVolumeAfter?: number;
  error?: string;
} {
  const { currentQty, containerCapacity, txType, amount } = params;
  if (txType === 'transfer') {
    if (!params.newLocation || params.newLocation.trim().length < 2) {
      return { valid: false, error: 'يرجى تحديد موقع التخزين الجديد للنقل.' };
    }
    const cap = containerCapacity && containerCapacity > 0 ? containerCapacity : 0;
    const totalAfter = Number((currentQty * cap).toFixed(4));
    return {
      valid: true,
      quantityDelta: 0,
      newBalance: currentQty,
      volumeDelta: 0,
      totalVolumeAfter: totalAfter,
    };
  }

  if (!Number.isFinite(amount)) {
    return { valid: false, error: 'الكمية المدخلة غير صالحة.' };
  }

  let delta = 0;
  let newBalance = currentQty;

  if (txType === 'receipt') {
    if (amount <= 0) return { valid: false, error: 'يجب أن تكون كمية الاستلام أكبر من صفر.' };
    delta = amount;
    newBalance = Number((currentQty + amount).toFixed(4));
  } else if (txType === 'issue') {
    if (amount <= 0) return { valid: false, error: 'يجب أن تكون كمية الصرف أكبر من صفر.' };
    if (amount > currentQty) {
      return {
        valid: false,
        error: `الكمية المطلوب صرفها (${amount}) تتجاوز الرصيد المتوفر حالياً (${currentQty}).`,
      };
    }
    delta = -amount;
    newBalance = Number((currentQty - amount).toFixed(4));
  } else if (txType === 'adjustment') {
    if (amount < 0) return { valid: false, error: 'لا يمكن أن يكون الرصيد المعدل أقل من صفر.' };
    delta = Number((amount - currentQty).toFixed(4));
    newBalance = Number(amount.toFixed(4));
  } else {
    return { valid: false, error: 'نوع الحركة المخزنية غير صالح.' };
  }

  const cap = containerCapacity && containerCapacity > 0 ? containerCapacity : 0;
  const volumeDelta = Number((delta * cap).toFixed(4));
  const totalVolumeAfter = Number((newBalance * cap).toFixed(4));

  return {
    valid: true,
    quantityDelta: delta,
    newBalance,
    volumeDelta,
    totalVolumeAfter,
  };
}
