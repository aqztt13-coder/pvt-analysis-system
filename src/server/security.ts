import crypto from 'node:crypto';
import path from 'node:path';
import type { Employee, UserRole } from '../shared/types';

export type PermissionResource =
  | 'dashboard'
  | 'employees'
  | 'attendance'
  | 'leaves'
  | 'equipment'
  | 'maintenance'
  | 'calibrations'
  | 'documents'
  | 'correspondence'
  | 'inventory'
  | 'requests'
  | 'meetings'
  | 'tasks'
  | 'training'
  | 'safety'
  | 'notifications'
  | 'reports'
  | 'users'
  | 'settings'
  | 'audit'
  | 'backups';

export type PermissionAction = 'read' | 'create' | 'update' | 'delete' | 'approve' | 'export';

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expectedHex = parts[5];
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !expectedHex) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, expectedHex.length / 2, { N, r, p });
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

export function validatePasswordPolicy(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return { valid: false, error: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.' };
  }
  if (!/[A-Za-z\u0600-\u06FF]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: 'يجب أن تحتوي كلمة المرور على أحرف وأرقام معاً.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'كلمة المرور طويلة جداً (الحد الأقصى 128 حرفاً).' };
  }
  return { valid: true };
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

export function canPerformAction(
  role: UserRole,
  resource: PermissionResource,
  action: PermissionAction
): boolean {
  if (role === 'manager') {
    // Audit logs are strictly immutable even for managers
    if (resource === 'audit' && action !== 'read' && action !== 'export') {
      return false;
    }
    return true;
  }

  if (role === 'viewer') {
    if (resource === 'users' || resource === 'settings' || resource === 'audit' || resource === 'backups') {
      return false;
    }
    return action === 'read';
  }

  // Engineer permissions
  if (role === 'engineer') {
    if (resource === 'users' || resource === 'settings' || resource === 'audit' || resource === 'backups') {
      return false;
    }
    if (action === 'read') {
      return true;
    }
    if (action === 'approve' || action === 'delete') {
      return false;
    }
    if (action === 'export') {
      return (
        resource === 'documents' ||
        resource === 'equipment' ||
        resource === 'maintenance' ||
        resource === 'calibrations' ||
        resource === 'reports'
      );
    }
    if (action === 'create') {
      return (
        resource === 'leaves' ||
        resource === 'maintenance' ||
        resource === 'calibrations' ||
        resource === 'documents' ||
        resource === 'correspondence' ||
        resource === 'inventory' ||
        resource === 'requests' ||
        resource === 'meetings' ||
        resource === 'tasks' ||
        resource === 'training' ||
        resource === 'safety'
      );
    }
    if (action === 'update') {
      return (
        resource === 'maintenance' ||
        resource === 'calibrations' ||
        resource === 'documents' ||
        resource === 'correspondence' ||
        resource === 'tasks' ||
        resource === 'safety' ||
        resource === 'notifications'
      );
    }
  }

  return false;
}

export function maskConfidentialEmployeeFields(employee: Employee, role: UserRole): Employee {
  if (role === 'manager') {
    return employee;
  }
  return {
    ...employee,
    birthDate: null,
    emergencyContact: null,
  };
}

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.xls',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
]);

export const MAX_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export function validateUploadFile(
  originalName: string,
  sizeBytes: number
): { valid: boolean; ext?: string; error?: string } {
  if (!originalName || typeof originalName !== 'string') {
    return { valid: false, error: 'اسم الملف غير صالح.' };
  }
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `امتداد الملف غير مسموح به (${ext || 'بدون امتداد'}). الامتدادات المسموحة: PDF, DOCX, XLSX, CSV, PNG, JPG, TXT.`,
    };
  }
  if (sizeBytes <= 0) {
    return { valid: false, error: 'الملف فارغ ولا يمكن رفعه.' };
  }
  if (sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    return { valid: false, error: 'حجم الملف يتجاوز الحد الأقصى المسموح به (15 ميغابايت).' };
  }
  return { valid: true, ext };
}

export function resolveSafePath(baseDir: string, unsafeSegment: string): string {
  if (!unsafeSegment || unsafeSegment.includes('\0')) {
    throw new Error('مسار ملف غير صالح.');
  }
  const normalizedBase = path.resolve(baseDir);
  const resolved = path.resolve(normalizedBase, unsafeSegment);
  if (!resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error('محاولة وصول غير مصرح بها خارج الدليل الآمن.');
  }
  return resolved;
}

export class LoginRateLimiter {
  private attempts = new Map<string, { count: number; lockedUntil: number }>();
  private readonly maxAttempts: number;
  private readonly lockoutMs: number;

  constructor(maxAttempts = 5, lockoutMs = 5 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.lockoutMs = lockoutMs;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds?: number } {
    const entry = this.attempts.get(key);
    if (!entry) return { allowed: true };
    if (entry.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
      };
    }
    if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
      this.attempts.delete(key);
    }
    return { allowed: true };
  }

  recordFailure(key: string, now = Date.now()): { locked: boolean; remaining: number } {
    const entry = this.attempts.get(key) ?? { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= this.maxAttempts) {
      entry.lockedUntil = now + this.lockoutMs;
      this.attempts.set(key, entry);
      return { locked: true, remaining: 0 };
    }
    this.attempts.set(key, entry);
    return { locked: false, remaining: this.maxAttempts - entry.count };
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
