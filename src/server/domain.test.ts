import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  canPerformAction,
  hashPassword,
  LoginRateLimiter,
  maskConfidentialEmployeeFields,
  resolveSafePath,
  validatePasswordPolicy,
  validateUploadFile,
  verifyPassword,
} from './security';
import { computeStockAdjustment, deriveNotifications } from './alerts';
import type { Employee } from '../shared/types';

test('scrypt password hashing verifies correct password and rejects wrong password', () => {
  const hash = hashPassword('PvtAdmin2026!');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('PvtAdmin2026!', hash), true);
  assert.equal(verifyPassword('WrongPass2026!', hash), false);
});

test('password policy rejects short or simple passwords and accepts mixed passwords', () => {
  assert.equal(validatePasswordPolicy('12345').valid, false);
  assert.equal(validatePasswordPolicy('abcdefgh').valid, false);
  assert.equal(validatePasswordPolicy('12345678').valid, false);
  assert.equal(validatePasswordPolicy('PvtLab2026').valid, true);
});

test('RBAC permission matrix strictly enforces manager, engineer, and viewer boundaries', () => {
  // Manager can approve leaves and manage backups, but cannot delete audit logs
  assert.equal(canPerformAction('manager', 'leaves', 'approve'), true);
  assert.equal(canPerformAction('manager', 'backups', 'create'), true);
  assert.equal(canPerformAction('manager', 'audit', 'read'), true);
  assert.equal(canPerformAction('manager', 'audit', 'delete'), false);

  // Engineer can upload documents and submit maintenance/leaves, cannot approve or access admin settings
  assert.equal(canPerformAction('engineer', 'documents', 'create'), true);
  assert.equal(canPerformAction('engineer', 'maintenance', 'create'), true);
  assert.equal(canPerformAction('engineer', 'leaves', 'create'), true);
  assert.equal(canPerformAction('engineer', 'leaves', 'approve'), false);
  assert.equal(canPerformAction('engineer', 'employees', 'delete'), false);
  assert.equal(canPerformAction('engineer', 'users', 'read'), false);
  assert.equal(canPerformAction('engineer', 'backups', 'read'), false);

  // Viewer is strictly read-only on non-admin modules
  assert.equal(canPerformAction('viewer', 'employees', 'read'), true);
  assert.equal(canPerformAction('viewer', 'documents', 'read'), true);
  assert.equal(canPerformAction('viewer', 'documents', 'create'), false);
  assert.equal(canPerformAction('viewer', 'maintenance', 'update'), false);
  assert.equal(canPerformAction('viewer', 'audit', 'read'), false);
});

test('confidential employee fields are visible only to division manager', () => {
  const sample: Employee = {
    id: 1,
    employeeCode: 'PVT-001',
    fullNameAr: 'أحمد حسن',
    fullNameEn: 'Ahmed Hassan',
    jobTitle: 'مهندس أقدم',
    section: 'وحدة التجهيز',
    qualification: 'بكالوريوس',
    specialization: 'هندسة نفط',
    category: 'هندسي',
    status: 'active',
    hireDate: '2019-05-01',
    birthDate: '1988-03-14',
    phone: '07701234567',
    extension: '401',
    email: 'ahmed@pvt.local',
    workplace: 'المبنى الرئيسي',
    jobDescription: 'متابعة إدارية',
    emergencyContact: '07709998888',
    notes: '',
    archived: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };

  assert.equal(maskConfidentialEmployeeFields(sample, 'manager').birthDate, '1988-03-14');
  assert.equal(maskConfidentialEmployeeFields(sample, 'engineer').birthDate, null);
  assert.equal(maskConfidentialEmployeeFields(sample, 'viewer').emergencyContact, null);
});

test('upload validation enforces allowlisted extensions and 15MB size limit', () => {
  assert.equal(validateUploadFile('monthly_report.pdf', 500_000).valid, true);
  assert.equal(validateUploadFile('script.exe', 1024).valid, false);
  assert.equal(validateUploadFile('shell.sh', 1024).valid, false);
  assert.equal(validateUploadFile('huge.pdf', 20 * 1024 * 1024).valid, false);
  assert.equal(validateUploadFile('empty.docx', 0).valid, false);
});

test('resolveSafePath blocks path traversal attempts', () => {
  const base = path.resolve('/tmp/pvt-uploads');
  const safe = resolveSafePath(base, 'abc-123.pdf');
  assert.ok(safe.startsWith(base + path.sep));
  assert.throws(() => resolveSafePath(base, '../../etc/passwd'));
  assert.throws(() => resolveSafePath(base, '../backups/db.sqlite'));
});

test('login rate limiter locks after 5 failures and clears after reset', () => {
  const limiter = new LoginRateLimiter(5, 60_000);
  const now = 1_000_000;
  for (let i = 0; i < 4; i++) {
    const res = limiter.recordFailure('user1', now);
    assert.equal(res.locked, false);
  }
  const fifth = limiter.recordFailure('user1', now);
  assert.equal(fifth.locked, true);
  assert.equal(limiter.check('user1', now + 1000).allowed, false);
  assert.equal(limiter.check('user1', now + 61_000).allowed, true);
});

test('stock adjustment prevents negative balance and computes exact ledger deltas', () => {
  const receipt = computeStockAdjustment(10, 'receipt', 5);
  assert.deepEqual(receipt, { valid: true, quantityDelta: 5, newBalance: 15 });

  const validIssue = computeStockAdjustment(10, 'issue', 4);
  assert.deepEqual(validIssue, { valid: true, quantityDelta: -4, newBalance: 6 });

  const overIssue = computeStockAdjustment(3, 'issue', 5);
  assert.equal(overIssue.valid, false);

  const adj = computeStockAdjustment(12, 'adjustment', 9);
  assert.deepEqual(adj, { valid: true, quantityDelta: -3, newBalance: 9 });
});

test('deriveNotifications generates accurate alerts from real operational dates', () => {
  const alerts = deriveNotifications(
    {
      pendingLeaves: [{ id: 1, employeeName: 'علي كريم', startDate: '2026-12-01' }],
      pendingRequests: [],
      maintenance: [
        {
          id: 2,
          workOrderNo: 'WO-2026-01',
          equipmentName: 'وحدة ضغط عالية',
          expectedEndDate: '2026-11-15',
          status: 'in_progress',
        },
      ],
      calibrations: [
        {
          id: 3,
          equipmentName: 'حساس ضغط مرجعي',
          certificateNumber: 'CAL-88',
          dueDate: '2026-12-05',
          status: 'due_soon',
        },
      ],
      equipment: [],
      inventory: [
        {
          id: 4,
          itemCode: 'INV-10',
          nameAr: 'حلقات إحكام Viton',
          quantity: 4,
          minStock: 10,
          expiryDate: '2026-12-10',
        },
      ],
      tasks: [
        {
          id: 5,
          title: 'تحديث سجل المعايرة السنوي',
          assignedTo: 'م. زينب علي',
          dueDate: '2026-11-20',
          status: 'in_progress',
        },
      ],
      correspondence: [],
      documents: [],
    },
    '2026-11-23',
    { calibrationAlertDays: 30, warrantyAlertDays: 60 }
  );

  assert.ok(alerts.some((a) => a.category === 'maintenance' && a.severity === 'critical'));
  assert.ok(alerts.some((a) => a.category === 'calibration' && a.severity === 'warning'));
  assert.ok(alerts.some((a) => a.category === 'inventory' && a.id === 'inv-low-4'));
  assert.ok(alerts.some((a) => a.category === 'inventory' && a.id === 'inv-exp-4'));
  assert.ok(alerts.some((a) => a.category === 'task' && a.severity === 'critical'));
  assert.ok(alerts.some((a) => a.category === 'leave'));
});
