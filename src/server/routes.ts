import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type {
  AuthUser,
  DashboardSummary,
  Employee,
  GlobalSearchResult,
  UserRole,
} from '../shared/types';
import { deriveNotifications } from './alerts';
import {
  createBackup,
  listBackups,
  restoreFromBackup,
  verifyBackupIntegrity,
} from './backup';
import { loadAppConfig, resolvePersistentSessionSecret } from './config';
import {
  getAppPaths,
  getDb,
  getSettings,
  saveSettings,
  seedInitialOperationalData,
  writeAuditLog,
} from './db';
import {
  calculateLeaveDuration,
  CHEMICAL_CATEGORY_AR,
  computeInventoryTransactionMath,
  computeTotalChemicalVolume,
  findConflictingLeave,
  formatVolumeUnitAr,
  OFFICIAL_DIVISION_NAME_AR,
  type InventoryTxKind,
} from './domainHelpers';
import {
  type ExportTablePayload,
  generateRtlExcelBuffer,
  generateRtlWordBuffer,
} from './exports';
import {
  canPerformAction,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  LoginRateLimiter,
  maskConfidentialEmployeeFields,
  MAX_UPLOAD_SIZE_BYTES,
  type PermissionAction,
  type PermissionResource,
  resolveSafePath,
  validatePasswordPolicy,
  validateUploadFile,
  verifyPassword,
} from './security';

interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionTokenHash?: string;
}

let cachedSessionSecret: string | null = null;
function getSessionSecret(): string {
  if (!cachedSessionSecret) {
    cachedSessionSecret = resolvePersistentSessionSecret(getDb());
  }
  return cachedSessionSecret;
}

const SESSION_TTL_HOURS = 12;
const loginLimiter = new LoginRateLimiter(5, 5 * 60 * 1000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
});

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '127.0.0.1';
}

function mapUserRow(row: Record<string, unknown>): AuthUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    fullNameAr: String(row.full_name_ar),
    fullNameEn: String(row.full_name_en || ''),
    role: row.role as UserRole,
    jobTitle: String(row.job_title || ''),
    email: String(row.email || ''),
    isActive: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    createdAt: String(row.created_at),
  };
}

function mapEmployeeRow(row: Record<string, unknown>, role: UserRole): Employee {
  const emp: Employee = {
    id: Number(row.id),
    employeeCode: String(row.employee_code),
    fullNameAr: String(row.full_name_ar),
    fullNameEn: String(row.full_name_en || ''),
    jobTitle: String(row.job_title),
    section: String(row.section),
    qualification: String(row.qualification || ''),
    specialization: String(row.specialization || ''),
    category: String(row.category || ''),
    status: row.status as Employee['status'],
    hireDate: String(row.hire_date || ''),
    birthDate: row.birth_date ? String(row.birth_date) : null,
    phone: String(row.phone || ''),
    extension: String(row.extension || ''),
    email: String(row.email || ''),
    workplace: String(row.workplace || ''),
    jobDescription: String(row.job_description || ''),
    emergencyContact: row.emergency_contact ? String(row.emergency_contact) : null,
    notes: String(row.notes || ''),
    archived: Boolean(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  return maskConfidentialEmployeeFields(emp, role);
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'يرجى تسجيل الدخول للوصول إلى هذا المورد.' });
    return;
  }

  const db = getDb();
  const tokenHash = hashSessionToken(token, getSessionSecret());
  const session = db
    .prepare(
      `SELECT s.id, s.expires_at, u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.is_active = 1`
    )
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!session) {
    res.status(401).json({ error: 'انتهت صلاحية الجلسة أو أنها غير صالحة.' });
    return;
  }

  if (new Date(String(session.expires_at)).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    res.status(401).json({ error: 'انتهت صلاحية جلسة العمل. يرجى تسجيل الدخول مجدداً.' });
    return;
  }

  req.user = mapUserRow(session);
  req.sessionTokenHash = tokenHash;
  next();
}

function requirePermission(resource: PermissionResource, action: PermissionAction) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'غير مصرح.' });
      return;
    }
    if (!canPerformAction(req.user.role, resource, action)) {
      res.status(403).json({
        error:
          req.user.role === 'viewer'
            ? 'صلاحية "مستعرض" مخصصة للقراءة فقط ولا تسمح بتعديل أو إنشاء السجلات.'
            : 'ليس لديك الصلاحية الكافية لتنفيذ هذا الإجراء الإداري.',
      });
      return;
    }
    next();
  };
}

function createSessionForUser(userId: number, req: Request): { token: string; expiresAt: string } {
  const db = getDb();
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token, getSessionSecret());
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();

  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  db.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, tokenHash, expiresAt, getClientIp(req), String(req.headers['user-agent'] || '').slice(0, 200));

  return { token, expiresAt };
}

function saveUploadedFile(
  file: Express.Multer.File,
  username: string,
  moduleName: string
): { id: number; originalName: string; sizeBytes: number; mimeType: string } {
  const check = validateUploadFile(file.originalname, file.size);
  if (!check.valid || !check.ext) {
    throw new Error(check.error || 'ملف غير صالح.');
  }

  const paths = getAppPaths();
  const storedName = `${crypto.randomUUID()}${check.ext}`;
  const targetPath = resolveSafePath(paths.uploadsDir, storedName);
  fs.writeFileSync(targetPath, file.buffer);

  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO uploaded_files (stored_name, original_name, mime_type, size_bytes, sha256, uploaded_by, module)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(storedName, file.originalname, file.mimetype || 'application/octet-stream', file.size, sha256, username, moduleName);

  return {
    id: Number(res.lastInsertRowid),
    originalName: file.originalname,
    sizeBytes: file.size,
    mimeType: file.mimetype || 'application/octet-stream',
  };
}

function getAllAlerts(userId: number) {
  const db = getDb();
  const settings = getSettings(db);
  const todayIso = new Date().toISOString().slice(0, 10);

  const readRows = db
    .prepare('SELECT notification_id FROM notification_reads WHERE user_id = ?')
    .all(userId) as Array<{ notification_id: string }>;
  const readSet = new Set(readRows.map((r) => r.notification_id));

  const pendingLeaves = db
    .prepare(
      `SELECT l.id, e.full_name_ar as employeeName, l.start_date as startDate
       FROM leave_requests l JOIN employees e ON e.id = l.employee_id
       WHERE l.status = 'pending'`
    )
    .all() as Array<{ id: number; employeeName: string; startDate: string }>;

  const pendingRequests = db
    .prepare(
      `SELECT id, request_number as requestNumber, title, submission_date as submissionDate
       FROM admin_requests WHERE status IN ('submitted', 'under_review')`
    )
    .all() as Array<{ id: number; requestNumber: string; title: string; submissionDate: string }>;

  const maintenance = db
    .prepare(
      `SELECT m.id, m.work_order_no as workOrderNo, e.name_ar as equipmentName,
              m.expected_end_date as expectedEndDate, m.status
       FROM maintenance_records m JOIN equipment e ON e.id = m.equipment_id`
    )
    .all() as Array<{
    id: number;
    workOrderNo: string;
    equipmentName: string;
    expectedEndDate: string;
    status: string;
  }>;

  const calibrations = db
    .prepare(
      `SELECT c.id, e.name_ar as equipmentName, c.certificate_number as certificateNumber,
              c.due_date as dueDate, c.status
       FROM calibration_records c JOIN equipment e ON e.id = c.equipment_id`
    )
    .all() as Array<{
    id: number;
    equipmentName: string;
    certificateNumber: string;
    dueDate: string;
    status: string;
  }>;

  const equipment = db
    .prepare(
      `SELECT id, equipment_code as equipmentCode, name_ar as nameAr, warranty_expiry as warrantyExpiry, status
       FROM equipment WHERE archived = 0`
    )
    .all() as Array<{
    id: number;
    equipmentCode: string;
    nameAr: string;
    warrantyExpiry: string;
    status: string;
  }>;

  const inventory = db
    .prepare(
      `SELECT id, item_code as itemCode, name_ar as nameAr, quantity, min_stock as minStock, expiry_date as expiryDate
       FROM inventory_items`
    )
    .all() as Array<{
    id: number;
    itemCode: string;
    nameAr: string;
    quantity: number;
    minStock: number;
    expiryDate: string | null;
  }>;

  const tasks = db
    .prepare(`SELECT id, title, assigned_to as assignedTo, due_date as dueDate, status FROM tasks`)
    .all() as Array<{
    id: number;
    title: string;
    assignedTo: string;
    dueDate: string;
    status: string;
  }>;

  const correspondence = db
    .prepare(
      `SELECT id, ref_number as refNumber, subject, due_date as dueDate, status FROM correspondence`
    )
    .all() as Array<{
    id: number;
    refNumber: string;
    subject: string;
    dueDate: string;
    status: string;
  }>;

  const documents = db
    .prepare(
      `SELECT id, doc_number as docNumber, title, review_due_date as reviewDueDate, status FROM documents`
    )
    .all() as Array<{
    id: number;
    docNumber: string;
    title: string;
    reviewDueDate: string | null;
    status: string;
  }>;

  return deriveNotifications(
    {
      pendingLeaves,
      pendingRequests,
      maintenance,
      calibrations,
      equipment,
      inventory,
      tasks,
      correspondence,
      documents,
    },
    todayIso,
    {
      calibrationAlertDays: settings.calibrationAlertDays,
      warrantyAlertDays: settings.warrantyAlertDays,
    },
    readSet
  );
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // ======================== HEALTH & AUTH ========================
  router.get('/health', (_req, res) => {
    const db = getDb();
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number };
    res.json({
      status: row?.ok === 1 ? 'healthy' : 'degraded',
      offlineReady: true,
      database: 'SQLite (WAL)',
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/auth/setup-status', (_req, res) => {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const settings = getSettings(db);
    res.json({
      needsSetup: count === 0,
      companyNameAr: settings.companyNameAr,
      divisionNameAr: settings.divisionNameAr,
      divisionNameEn: settings.divisionNameEn,
    });
  });

  router.post('/auth/setup', (req, res) => {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    if (count > 0) {
      res.status(409).json({ error: 'تم إكمال الإعداد الأولي مسبقاً. يرجى تسجيل الدخول.' });
      return;
    }

    const { username, password, fullNameAr, fullNameEn, email, loadSampleData } = req.body || {};
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanNameAr = String(fullNameAr || '').trim();
    const cleanNameEn = String(fullNameEn || '').trim();
    const cleanEmail = String(email || '').trim();

    if (!cleanUser || cleanUser.length < 3 || !/^[a-z0-9._-]+$/.test(cleanUser)) {
      res.status(400).json({ error: 'اسم المستخدم يجب أن يكون 3 أحرف إنجليزية أو أرقام على الأقل بدون مسافات.' });
      return;
    }
    if (!cleanNameAr || cleanNameAr.length < 3) {
      res.status(400).json({ error: 'يرجى إدخال الاسم الكامل لمدير الشعبة بالعربية.' });
      return;
    }

    const policy = validatePasswordPolicy(String(password || ''));
    if (!policy.valid) {
      res.status(400).json({ error: policy.error });
      return;
    }

    const passwordHash = hashPassword(String(password));
    const inserted = db
      .prepare(
        `INSERT INTO users (username, password_hash, full_name_ar, full_name_en, role, job_title, email, is_active, last_login_at)
         VALUES (?, ?, ?, ?, 'manager', ?, ?, 1, datetime('now'))`
      )
      .run(cleanUser, passwordHash, cleanNameAr, cleanNameEn, `مدير ${OFFICIAL_DIVISION_NAME_AR}`, cleanEmail);

    const userId = Number(inserted.lastInsertRowid);
    if (loadSampleData === true) {
      seedInitialOperationalData(db, cleanNameAr);
    }

    writeAuditLog(db, {
      username: cleanUser,
      userRole: 'manager',
      action: 'INITIAL_ADMIN_SETUP',
      module: 'auth',
      recordRef: cleanUser,
      description: 'تم إنشاء حساب مدير الشعبة الأول وتفعيل النظام.',
      ipAddress: getClientIp(req),
    });

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
    const { token, expiresAt } = createSessionForUser(userId, req);
    res.status(201).json({ token, expiresAt, user: mapUserRow(userRow) });
  });

  router.post('/auth/login', (req, res) => {
    const db = getDb();
    const { username, password } = req.body || {};
    const cleanUser = String(username || '').trim().toLowerCase();
    const ip = getClientIp(req);
    const rateKey = `${cleanUser || 'anon'}@${ip}`;

    const rateCheck = loginLimiter.check(rateKey);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: `تم إيقاف محاولات الدخول مؤقتاً بسبب تكرار المحاولات الخاطئة. يرجى الانتظار ${rateCheck.retryAfterSeconds} ثانية.`,
      });
      return;
    }

    if (!cleanUser || !password) {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
      return;
    }

    const userRow = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUser) as
      | Record<string, unknown>
      | undefined;

    if (
      !userRow ||
      !userRow.is_active ||
      !verifyPassword(String(password), String(userRow.password_hash))
    ) {
      const failState = loginLimiter.recordFailure(rateKey);
      writeAuditLog(db, {
        username: cleanUser || 'unknown',
        userRole: userRow ? String(userRow.role) : 'unknown',
        action: 'LOGIN_FAILED',
        module: 'auth',
        recordRef: cleanUser,
        description: failState.locked
          ? 'فشل تسجيل الدخول وتم تفعيل الحماية المؤقتة للحساب.'
          : 'محاولة تسجيل دخول فاشلة (بيانات غير صحيحة).',
        ipAddress: ip,
      });
      res.status(401).json({
        error: failState.locked
          ? 'تم تجاوز عدد المحاولات المسموحة. تم تعليق الدخول مؤقتاً لمدة 5 دقائق.'
          : `اسم المستخدم أو كلمة المرور غير صحيحة (المحاولات المتبقية: ${failState.remaining}).`,
      });
      return;
    }

    loginLimiter.clear(rateKey);
    const userId = Number(userRow.id);
    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(userId);
    const { token, expiresAt } = createSessionForUser(userId, req);

    writeAuditLog(db, {
      username: cleanUser,
      userRole: String(userRow.role),
      action: 'LOGIN_SUCCESS',
      module: 'auth',
      recordRef: cleanUser,
      description: 'تسجيل دخول ناجح إلى النظام.',
      ipAddress: ip,
    });

    const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
    res.json({ token, expiresAt, user: mapUserRow(refreshed) });
  });

  router.post('/auth/logout', requireAuth, (req: AuthedRequest, res) => {
    const db = getDb();
    if (req.sessionTokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
    }
    if (req.user) {
      writeAuditLog(db, {
        username: req.user.username,
        userRole: req.user.role,
        action: 'LOGOUT',
        module: 'auth',
        recordRef: req.user.username,
        description: 'تسجيل خروج من النظام.',
        ipAddress: getClientIp(req),
      });
    }
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const db = getDb();
    res.json({ user: req.user, settings: getSettings(db) });
  });

  router.post('/auth/change-password', requireAuth, (req: AuthedRequest, res) => {
    const db = getDb();
    const { currentPassword, newPassword } = req.body || {};
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as Record<string, unknown>;

    if (!verifyPassword(String(currentPassword || ''), String(userRow.password_hash))) {
      res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
      return;
    }
    const policy = validatePasswordPolicy(String(newPassword || ''));
    if (!policy.valid) {
      res.status(400).json({ error: policy.error });
      return;
    }

    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      hashPassword(String(newPassword)),
      req.user!.id
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'PASSWORD_CHANGE',
      module: 'auth',
      recordRef: req.user!.username,
      description: 'تم تحديث كلمة مرور الحساب بنجاح.',
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  // ======================== DASHBOARD ========================
  router.get('/dashboard', requireAuth, (req: AuthedRequest, res) => {
    const db = getDb();
    const settings = getSettings(db);
    const todayIso = new Date().toISOString().slice(0, 10);

    const totalEmployees = (db.prepare('SELECT COUNT(*) as c FROM employees WHERE archived = 0').get() as { c: number }).c;
    const activeEmployees = (db.prepare(`SELECT COUNT(*) as c FROM employees WHERE archived = 0 AND status = 'active'`).get() as { c: number }).c;
    const onLeaveEmployees = (db.prepare(`SELECT COUNT(*) as c FROM employees WHERE archived = 0 AND status = 'on_leave'`).get() as { c: number }).c;

    const totalEquipment = (db.prepare('SELECT COUNT(*) as c FROM equipment WHERE archived = 0').get() as { c: number }).c;
    const equipmentUnderMaintenance = (db.prepare(`SELECT COUNT(*) as c FROM equipment WHERE archived = 0 AND status = 'under_maintenance'`).get() as { c: number }).c;

    const calDueLimit = new Date(Date.now() + settings.calibrationAlertDays * 86400000).toISOString().slice(0, 10);
    const upcomingCalibrations = (
      db.prepare(`SELECT COUNT(*) as c FROM calibration_records WHERE due_date <= ?`).get(calDueLimit) as { c: number }
    ).c;

    const totalDocuments = (db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number }).c;
    const pendingRequests = (db.prepare(`SELECT COUNT(*) as c FROM admin_requests WHERE status IN ('submitted', 'under_review')`).get() as { c: number }).c;
    const pendingLeaves = (db.prepare(`SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending'`).get() as { c: number }).c;
    const outstandingTasks = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status != 'completed'`).get() as { c: number }).c;
    const lowStockCount = (db.prepare(`SELECT COUNT(*) as c FROM inventory_items WHERE quantity <= min_stock`).get() as { c: number }).c;
    const overdueCorrespondence = (
      db.prepare(`SELECT COUNT(*) as c FROM correspondence WHERE status NOT IN ('completed', 'archived') AND due_date != '' AND due_date < ?`).get(todayIso) as { c: number }
    ).c;

    const statusLabels: Record<string, string> = {
      operational: 'قيد التشغيل',
      under_maintenance: 'قيد الصيانة',
      under_inspection: 'قيد الفحص',
      out_of_service: 'خارج الخدمة',
      retired: 'متقاعد',
    };
    const eqStatusRows = db
      .prepare(`SELECT status, COUNT(*) as count FROM equipment WHERE archived = 0 GROUP BY status`)
      .all() as Array<{ status: string; count: number }>;
    const equipmentByStatus = eqStatusRows.map((r) => ({
      key: r.status,
      name: statusLabels[r.status] || r.status,
      value: r.count,
    }));

    const docsByCatRows = db
      .prepare(`SELECT category as name, COUNT(*) as count FROM documents GROUP BY category ORDER BY count DESC LIMIT 6`)
      .all() as Array<{ name: string; count: number }>;

    const recentDocsRaw = db
      .prepare(
        `SELECT d.*, f.original_name as file_name, f.size_bytes as file_size, f.mime_type as file_mime
         FROM documents d
         LEFT JOIN uploaded_files f ON f.id = d.file_id
         ORDER BY d.created_at DESC LIMIT 5`
      )
      .all() as Array<Record<string, unknown>>;

    const recentDocuments = recentDocsRaw.map((r) => ({
      id: Number(r.id),
      docNumber: String(r.doc_number),
      title: String(r.title),
      category: String(r.category),
      referenceNumber: String(r.reference_number || ''),
      creationDate: String(r.creation_date),
      submissionDate: String(r.submission_date || ''),
      author: String(r.author),
      responsiblePerson: String(r.responsible_person || ''),
      relatedEmployeeId: r.related_employee_id ? Number(r.related_employee_id) : null,
      relatedEquipmentId: r.related_equipment_id ? Number(r.related_equipment_id) : null,
      description: String(r.description || ''),
      tags: String(r.tags || ''),
      status: r.status as 'draft' | 'under_review' | 'approved' | 'archived',
      revisionNo: Number(r.revision_no),
      approvedBy: r.approved_by ? String(r.approved_by) : null,
      approvedAt: r.approved_at ? String(r.approved_at) : null,
      reviewDueDate: r.review_due_date ? String(r.review_due_date) : null,
      fileId: r.file_id ? Number(r.file_id) : null,
      fileName: r.file_name ? String(r.file_name) : null,
      fileSize: r.file_size ? Number(r.file_size) : null,
      fileMime: r.file_mime ? String(r.file_mime) : null,
      createdAt: String(r.created_at),
    }));

    const alerts = getAllAlerts(req.user!.id);
    const catMap: Record<string, string> = {
      calibration: 'معايرة',
      maintenance: 'صيانة',
      task: 'مهمة',
      correspondence: 'مراسلة',
      inventory: 'مخزون',
      leave: 'إجازة',
      approval: 'اعتماد',
      warranty: 'ضمان',
      document: 'وثيقة',
    };
    const upcomingDeadlines = alerts
      .filter((a) => a.dueDate)
      .slice(0, 7)
      .map((a) => ({
        id: a.id,
        title: a.title,
        module: a.targetModule,
        dueDate: a.dueDate!,
        severity: a.severity,
        categoryLabel: catMap[a.category] || a.category,
      }));

    const auditRows = db
      .prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 8`)
      .all() as Array<Record<string, unknown>>;
    const recentActivities = auditRows.map((a) => ({
      id: Number(a.id),
      username: String(a.username),
      userRole: String(a.user_role),
      action: String(a.action),
      module: String(a.module),
      recordRef: String(a.record_ref || ''),
      description: String(a.description),
      ipAddress: String(a.ip_address || ''),
      createdAt: String(a.created_at),
    }));

    const summary: DashboardSummary = {
      kpis: {
        totalEmployees,
        activeEmployees,
        onLeaveEmployees,
        totalEquipment,
        equipmentUnderMaintenance,
        upcomingCalibrations,
        totalDocuments,
        pendingRequests,
        pendingLeaves,
        outstandingTasks,
        lowStockCount,
        overdueCorrespondence,
      },
      equipmentByStatus,
      documentsByCategory: docsByCatRows,
      recentDocuments,
      upcomingDeadlines,
      recentActivities,
    };

    res.json(summary);
  });

  // ======================== GLOBAL SEARCH ========================
  router.get('/search', requireAuth, (req: AuthedRequest, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) {
      res.json({ results: [] });
      return;
    }
    const db = getDb();
    const like = `%${q}%`;
    const results: GlobalSearchResult[] = [];

    const emps = db
      .prepare(
        `SELECT id, employee_code, full_name_ar, job_title, status, hire_date
         FROM employees WHERE archived = 0 AND (employee_code LIKE ? OR full_name_ar LIKE ? OR full_name_en LIKE ? OR job_title LIKE ? OR section LIKE ?) LIMIT 8`
      )
      .all(like, like, like, like, like) as Array<Record<string, unknown>>;
    emps.forEach((e) =>
      results.push({
        module: 'employees',
        moduleLabel: 'الموظفون',
        id: Number(e.id),
        code: String(e.employee_code),
        title: String(e.full_name_ar),
        subtitle: String(e.job_title),
        status: String(e.status),
        date: String(e.hire_date || ''),
      })
    );

    const eqs = db
      .prepare(
        `SELECT id, equipment_code, name_ar, manufacturer, model, status, acquisition_date
         FROM equipment WHERE archived = 0 AND (equipment_code LIKE ? OR name_ar LIKE ? OR name_en LIKE ? OR serial_number LIKE ? OR asset_number LIKE ?) LIMIT 8`
      )
      .all(like, like, like, like, like) as Array<Record<string, unknown>>;
    eqs.forEach((e) =>
      results.push({
        module: 'equipment',
        moduleLabel: 'المعدات',
        id: Number(e.id),
        code: String(e.equipment_code),
        title: String(e.name_ar),
        subtitle: `${e.manufacturer || ''} ${e.model || ''}`.trim(),
        status: String(e.status),
        date: String(e.acquisition_date || ''),
      })
    );

    const docs = db
      .prepare(
        `SELECT id, doc_number, title, category, status, creation_date
         FROM documents WHERE doc_number LIKE ? OR title LIKE ? OR reference_number LIKE ? OR tags LIKE ? LIMIT 8`
      )
      .all(like, like, like, like) as Array<Record<string, unknown>>;
    docs.forEach((d) =>
      results.push({
        module: 'documents',
        moduleLabel: 'الأرشيف والتقارير',
        id: Number(d.id),
        code: String(d.doc_number),
        title: String(d.title),
        subtitle: String(d.category),
        status: String(d.status),
        date: String(d.creation_date || ''),
      })
    );

    const corrs = db
      .prepare(
        `SELECT id, ref_number, subject, sender, recipient, status, due_date
         FROM correspondence WHERE ref_number LIKE ? OR subject LIKE ? OR sender LIKE ? OR recipient LIKE ? LIMIT 8`
      )
      .all(like, like, like, like) as Array<Record<string, unknown>>;
    corrs.forEach((c) =>
      results.push({
        module: 'correspondence',
        moduleLabel: 'المراسلات',
        id: Number(c.id),
        code: String(c.ref_number),
        title: String(c.subject),
        subtitle: `${c.sender} ← ${c.recipient}`,
        status: String(c.status),
        date: String(c.due_date || ''),
      })
    );

    const maints = db
      .prepare(
        `SELECT m.id, m.work_order_no, m.description, e.name_ar as eq_name, m.status, m.expected_end_date
         FROM maintenance_records m JOIN equipment e ON e.id = m.equipment_id
         WHERE m.work_order_no LIKE ? OR m.description LIKE ? OR e.name_ar LIKE ? LIMIT 6`
      )
      .all(like, like, like) as Array<Record<string, unknown>>;
    maints.forEach((m) =>
      results.push({
        module: 'maintenance',
        moduleLabel: 'الصيانة',
        id: Number(m.id),
        code: String(m.work_order_no),
        title: String(m.eq_name),
        subtitle: String(m.description).slice(0, 70),
        status: String(m.status),
        date: String(m.expected_end_date || ''),
      })
    );

    const invs = db
      .prepare(
        `SELECT id, item_code, name_ar, category, quantity, unit, updated_at
         FROM inventory_items WHERE item_code LIKE ? OR name_ar LIKE ? OR category LIKE ? LIMIT 6`
      )
      .all(like, like, like) as Array<Record<string, unknown>>;
    invs.forEach((i) =>
      results.push({
        module: 'inventory',
        moduleLabel: 'المخزون',
        id: Number(i.id),
        code: String(i.item_code),
        title: String(i.name_ar),
        subtitle: `${i.category} — المتوفر: ${i.quantity} ${i.unit}`,
        status: 'active',
        date: String(i.updated_at || '').slice(0, 10),
      })
    );

    const reqs = db
      .prepare(
        `SELECT id, request_number, title, requester_name, status, submission_date
         FROM admin_requests WHERE request_number LIKE ? OR title LIKE ? OR requester_name LIKE ? LIMIT 6`
      )
      .all(like, like, like) as Array<Record<string, unknown>>;
    reqs.forEach((r) =>
      results.push({
        module: 'requests',
        moduleLabel: 'الطلبات والمشتريات',
        id: Number(r.id),
        code: String(r.request_number),
        title: String(r.title),
        subtitle: String(r.requester_name),
        status: String(r.status),
        date: String(r.submission_date || ''),
      })
    );

    const tasks = db
      .prepare(
        `SELECT id, title, assigned_to, status, due_date FROM tasks WHERE title LIKE ? OR assigned_to LIKE ? LIMIT 6`
      )
      .all(like, like) as Array<Record<string, unknown>>;
    tasks.forEach((t) =>
      results.push({
        module: 'meetings',
        moduleLabel: 'المهام والاجتماعات',
        id: Number(t.id),
        code: `TASK-${t.id}`,
        title: String(t.title),
        subtitle: `المكلف: ${t.assigned_to}`,
        status: String(t.status),
        date: String(t.due_date || ''),
      })
    );

    res.json({ results });
  });

  // ======================== SECURE FILE UPLOAD & DOWNLOAD ========================
  router.post(
    '/files/upload',
    requireAuth,
    requirePermission('documents', 'create'),
    upload.single('file'),
    (req: AuthedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'لم يتم إرفاق أي ملف.' });
          return;
        }
        const moduleName = String(req.body?.module || 'documents');
        const saved = saveUploadedFile(req.file, req.user!.username, moduleName);
        writeAuditLog(getDb(), {
          username: req.user!.username,
          userRole: req.user!.role,
          action: 'FILE_UPLOAD',
          module: moduleName,
          recordRef: String(saved.id),
          description: `رفع ملف مرفق: ${saved.originalName} (${saved.sizeBytes} بايت).`,
          ipAddress: getClientIp(req),
        });
        res.status(201).json(saved);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'فشل رفع الملف.' });
      }
    }
  );

  router.get('/files/:id/download', requireAuth, (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const fileRow = db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    if (!fileRow) {
      res.status(404).json({ error: 'الملف غير موجود.' });
      return;
    }

    try {
      const paths = getAppPaths();
      const absPath = resolveSafePath(paths.uploadsDir, String(fileRow.stored_name));
      if (!fs.existsSync(absPath)) {
        res.status(404).json({ error: 'الملف غير متوفر على الخادم.' });
        return;
      }

      const inline = req.query.inline === '1';
      const mime = String(fileRow.mime_type || 'application/octet-stream');
      const safeInline =
        inline && (mime === 'application/pdf' || mime.startsWith('image/') || mime === 'text/plain');

      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'FILE_DOWNLOAD',
        module: String(fileRow.module),
        recordRef: String(id),
        description: `تنزيل/معاينة الملف: ${fileRow.original_name}`,
        ipAddress: getClientIp(req),
      });

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', mime);
      const encodedName = encodeURIComponent(String(fileRow.original_name));
      res.setHeader(
        'Content-Disposition',
        `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`
      );
      fs.createReadStream(absPath).pipe(res);
    } catch {
      res.status(403).json({ error: 'وصول غير مصرح به للملف.' });
    }
  });

  // ======================== EMPLOYEES ========================
  router.get('/employees', requireAuth, requirePermission('employees', 'read'), (req: AuthedRequest, res) => {
    const db = getDb();
    const showArchived = req.query.archived === '1' ? 1 : 0;
    const rows = db
      .prepare(`SELECT * FROM employees WHERE archived = ? ORDER BY employee_code ASC`)
      .all(showArchived) as Array<Record<string, unknown>>;
    res.json({ items: rows.map((r) => mapEmployeeRow(r, req.user!.role)) });
  });

  router.get('/employees/:id/profile', requireAuth, requirePermission('employees', 'read'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!empRow) {
      res.status(404).json({ error: 'الموظف غير موجود.' });
      return;
    }
    const employee = mapEmployeeRow(empRow, req.user!.role);
    const leaves = db
      .prepare(
        `SELECT l.*, lt.name_ar as leave_type_name FROM leave_requests l
         LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
         WHERE l.employee_id = ? ORDER BY l.start_date DESC`
      )
      .all(id);
    const trainings = db
      .prepare(`SELECT * FROM training_records WHERE employee_id = ? ORDER BY start_date DESC`)
      .all(id);
    const equipment = db
      .prepare(`SELECT id, equipment_code, name_ar, status, location FROM equipment WHERE custodian_id = ? AND archived = 0`)
      .all(id);
    const documents = db
      .prepare(`SELECT id, doc_number, title, category, creation_date, status FROM documents WHERE related_employee_id = ? ORDER BY creation_date DESC`)
      .all(id);

    res.json({ employee, leaves, trainings, equipment, documents });
  });

  router.post('/employees', requireAuth, requirePermission('employees', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.employeeCode || !b.fullNameAr || !b.jobTitle || !b.section) {
      res.status(400).json({ error: 'يرجى استكمال الحقول الإلزامية (الرقم الوظيفي، الاسم بالعربية، العنوان الوظيفي، الوحدة).' });
      return;
    }
    try {
      const r = db
        .prepare(
          `INSERT INTO employees (
            employee_code, full_name_ar, full_name_en, job_title, section,
            qualification, specialization, category, status, hire_date, birth_date,
            phone, extension, email, workplace, job_description, emergency_contact, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(b.employeeCode).trim(),
          String(b.fullNameAr).trim(),
          String(b.fullNameEn || '').trim(),
          String(b.jobTitle).trim(),
          String(b.section).trim(),
          String(b.qualification || ''),
          String(b.specialization || ''),
          String(b.category || 'هندسي'),
          String(b.status || 'active'),
          String(b.hireDate || ''),
          b.birthDate ? String(b.birthDate) : null,
          String(b.phone || ''),
          String(b.extension || ''),
          String(b.email || ''),
          String(b.workplace || ''),
          String(b.jobDescription || ''),
          b.emergencyContact ? String(b.emergencyContact) : null,
          String(b.notes || '')
        );
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'CREATE',
        module: 'employees',
        recordRef: String(b.employeeCode),
        description: `إضافة ملف موظف جديد: ${b.fullNameAr}`,
        ipAddress: getClientIp(req),
      });
      const created = db.prepare('SELECT * FROM employees WHERE id = ?').get(r.lastInsertRowid) as Record<string, unknown>;
      res.status(201).json(mapEmployeeRow(created, req.user!.role));
    } catch {
      res.status(409).json({ error: 'الرقم الوظيفي مسجل مسبقاً أو توجد بيانات مكررة.' });
    }
  });

  router.put('/employees/:id', requireAuth, requirePermission('employees', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const b = req.body || {};
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'الموظف غير موجود.' });
      return;
    }
    try {
      db.prepare(
        `UPDATE employees SET
          employee_code = ?, full_name_ar = ?, full_name_en = ?, job_title = ?, section = ?,
          qualification = ?, specialization = ?, category = ?, status = ?, hire_date = ?,
          birth_date = ?, phone = ?, extension = ?, email = ?, workplace = ?,
          job_description = ?, emergency_contact = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        String(b.employeeCode || existing.employee_code).trim(),
        String(b.fullNameAr || existing.full_name_ar).trim(),
        String(b.fullNameEn ?? existing.full_name_en ?? ''),
        String(b.jobTitle || existing.job_title).trim(),
        String(b.section || existing.section).trim(),
        String(b.qualification ?? existing.qualification ?? ''),
        String(b.specialization ?? existing.specialization ?? ''),
        String(b.category ?? existing.category ?? ''),
        String(b.status || existing.status),
        String(b.hireDate ?? existing.hire_date ?? ''),
        b.birthDate !== undefined ? b.birthDate || null : existing.birth_date,
        String(b.phone ?? existing.phone ?? ''),
        String(b.extension ?? existing.extension ?? ''),
        String(b.email ?? existing.email ?? ''),
        String(b.workplace ?? existing.workplace ?? ''),
        String(b.jobDescription ?? existing.job_description ?? ''),
        b.emergencyContact !== undefined ? b.emergencyContact || null : existing.emergency_contact,
        String(b.notes ?? existing.notes ?? ''),
        id
      );
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'UPDATE',
        module: 'employees',
        recordRef: String(b.employeeCode || existing.employee_code),
        description: `تحديث بيانات الموظف: ${b.fullNameAr || existing.full_name_ar}`,
        ipAddress: getClientIp(req),
      });
      const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as Record<string, unknown>;
      res.json(mapEmployeeRow(updated, req.user!.role));
    } catch {
      res.status(409).json({ error: 'تعذر تحديث بيانات الموظف (تحقق من عدم تكرار الرقم الوظيفي).' });
    }
  });

  router.delete('/employees/:id', requireAuth, requirePermission('employees', 'delete'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'الموظف غير موجود.' });
      return;
    }
    db.prepare(`UPDATE employees SET archived = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'ARCHIVE',
      module: 'employees',
      recordRef: String(existing.employee_code),
      description: `أرشفة ملف الموظف: ${existing.full_name_ar}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  // ======================== ATTENDANCE & LEAVES ========================
  router.get('/attendance', requireAuth, requirePermission('attendance', 'read'), (req: AuthedRequest, res) => {
    const db = getDb();
    const date = String(req.query.date || '');
    const records = date
      ? db
          .prepare(
            `SELECT a.*, e.full_name_ar as employee_name, e.employee_code
             FROM attendance_records a JOIN employees e ON e.id = a.employee_id
             WHERE a.work_date = ? ORDER BY e.employee_code ASC`
          )
          .all(date)
      : db
          .prepare(
            `SELECT a.*, e.full_name_ar as employee_name, e.employee_code
             FROM attendance_records a JOIN employees e ON e.id = a.employee_id
             ORDER BY a.work_date DESC, e.employee_code ASC LIMIT 200`
          )
          .all();

    const holidays = db.prepare('SELECT * FROM official_holidays ORDER BY holiday_date DESC').all();
    const leaveTypes = db.prepare('SELECT * FROM leave_types ORDER BY id ASC').all();
    const leaves = db
      .prepare(
        `SELECT l.*,
                e.full_name_ar as employee_name,
                e.employee_code,
                e.job_title as employee_job_title,
                e.section as employee_section,
                lt.name_ar as leave_type_name,
                uf.original_name as file_name
         FROM leave_requests l
         JOIN employees e ON e.id = l.employee_id
         LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
         LEFT JOIN uploaded_files uf ON uf.id = l.file_id
         ORDER BY l.created_at DESC, l.id DESC`
      )
      .all();

    res.json({
      attendance: (records as Array<Record<string, unknown>>).map((r) => ({
        id: Number(r.id),
        employeeId: Number(r.employee_id),
        employeeName: String(r.employee_name),
        employeeCode: String(r.employee_code),
        workDate: String(r.work_date),
        status: r.status,
        checkIn: String(r.check_in || ''),
        checkOut: String(r.check_out || ''),
        notes: String(r.notes || ''),
        recordedBy: String(r.recorded_by),
        createdAt: String(r.created_at),
      })),
      holidays: (holidays as Array<Record<string, unknown>>).map((h) => ({
        id: Number(h.id),
        title: String(h.title),
        holidayDate: String(h.holiday_date),
        endDate: String(h.end_date),
        notes: String(h.notes || ''),
      })),
      leaveTypes: (leaveTypes as Array<Record<string, unknown>>).map((t) => ({
        id: Number(t.id),
        code: String(t.code),
        nameAr: String(t.name_ar),
        nameEn: String(t.name_en || ''),
        annualAllowance: Number(t.annual_allowance),
        requiresAttachment: Boolean(t.requires_attachment),
        isActive: Boolean(t.is_active),
      })),
      leaves: (leaves as Array<Record<string, unknown>>).map((l) => ({
        id: Number(l.id),
        employeeId: Number(l.employee_id),
        employeeName: String(l.employee_name),
        employeeCode: String(l.employee_code),
        employeeJobTitle: String(l.employee_job_title || ''),
        employeeSection: String(l.employee_section || ''),
        leaveTypeCode: String(l.leave_type_code),
        leaveTypeName: String(l.leave_type_name || l.leave_type_code),
        startDate: String(l.start_date),
        endDate: String(l.end_date),
        daysCount: Number(l.days_count),
        destination: String(l.destination || ''),
        destinationCountry: String(l.destination_country || ''),
        destinationCity: String(l.destination_city || ''),
        travelNotes: String(l.travel_notes || ''),
        submissionDate: String(l.submission_date || String(l.created_at).slice(0, 10)),
        reason: String(l.reason || ''),
        status: l.status,
        decisionNotes: String(l.decision_notes || ''),
        decidedBy: l.decided_by ? String(l.decided_by) : null,
        decidedAt: l.decided_at ? String(l.decided_at) : null,
        fileId: l.file_id ? Number(l.file_id) : null,
        fileName: l.file_name ? String(l.file_name) : null,
        createdAt: String(l.created_at),
      })),
    });
  });

  router.post('/leave-types', requireAuth, requirePermission('settings', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const { code, nameAr, nameEn, requiresAttachment } = req.body || {};
    const cleanCode = String(code || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_');
    const cleanNameAr = String(nameAr || '').trim();
    if (!cleanCode || cleanCode.length < 2 || !cleanNameAr) {
      res.status(400).json({ error: 'يرجى إدخال رمز صالح واسم عربي لنوع الإجازة.' });
      return;
    }
    try {
      const r = db
        .prepare(
          `INSERT INTO leave_types (code, name_ar, name_en, annual_allowance, requires_attachment, is_active)
           VALUES (?, ?, ?, 0, ?, 1)`
        )
        .run(cleanCode, cleanNameAr, String(nameEn || '').trim(), requiresAttachment ? 1 : 0);
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'CREATE',
        module: 'leaves',
        recordRef: cleanCode,
        description: `إضافة نوع إجازة جديد: ${cleanNameAr} (${cleanCode}).`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ id: Number(r.lastInsertRowid), code: cleanCode });
    } catch {
      res.status(409).json({ error: 'رمز نوع الإجازة مسجل مسبقاً.' });
    }
  });

  router.patch('/leave-types/:id', requireAuth, requirePermission('settings', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'نوع الإجازة غير موجود.' });
      return;
    }
    const { nameAr, nameEn, requiresAttachment, isActive } = req.body || {};
    db.prepare(
      `UPDATE leave_types SET name_ar = ?, name_en = ?, requires_attachment = ?, is_active = ? WHERE id = ?`
    ).run(
      nameAr ? String(nameAr).trim() : String(existing.name_ar),
      nameEn !== undefined ? String(nameEn).trim() : String(existing.name_en || ''),
      requiresAttachment !== undefined ? (requiresAttachment ? 1 : 0) : Number(existing.requires_attachment),
      isActive !== undefined ? (isActive ? 1 : 0) : Number(existing.is_active),
      id
    );
    res.json({ ok: true });
  });

  router.post('/attendance', requireAuth, requirePermission('attendance', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const { employeeId, workDate, status, checkIn, checkOut, notes } = req.body || {};
    if (!employeeId || !workDate || !status) {
      res.status(400).json({ error: 'يرجى تحديد الموظف والتاريخ وحالة الدوام.' });
      return;
    }
    db.prepare(
      `INSERT INTO attendance_records (employee_id, work_date, status, check_in, check_out, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out,
         notes = excluded.notes, recorded_by = excluded.recorded_by`
    ).run(Number(employeeId), String(workDate), String(status), String(checkIn || ''), String(checkOut || ''), String(notes || ''), req.user!.fullNameAr);

    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'UPSERT',
      module: 'attendance',
      recordRef: `${employeeId}/${workDate}`,
      description: `تسجيل/تعديل حالة حضور بتاريخ ${workDate} (${status}).`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ ok: true });
  });

  router.post('/holidays', requireAuth, requirePermission('attendance', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const { title, holidayDate, endDate, notes } = req.body || {};
    if (!title || !holidayDate) {
      res.status(400).json({ error: 'يرجى إدخال اسم العطلة وتاريخها.' });
      return;
    }
    db.prepare(`INSERT INTO official_holidays (title, holiday_date, end_date, notes) VALUES (?, ?, ?, ?)`).run(
      String(title),
      String(holidayDate),
      String(endDate || holidayDate),
      String(notes || '')
    );
    res.status(201).json({ ok: true });
  });

  router.post('/leaves', requireAuth, requirePermission('leaves', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const {
      employeeId,
      leaveTypeCode,
      startDate,
      endDate,
      destination,
      destinationCountry,
      destinationCity,
      travelNotes,
      submissionDate,
      reason,
      fileId,
    } = req.body || {};

    const empId = Number(employeeId);
    const typeCode = String(leaveTypeCode || '').trim();
    if (!empId || !typeCode || !startDate || !endDate) {
      res.status(400).json({ error: 'يرجى تعبئة جميع الحقول الإلزامية لطلب الإجازة.' });
      return;
    }

    const emp = db.prepare('SELECT id, full_name_ar FROM employees WHERE id = ? AND archived = 0').get(empId) as
      | { id: number; full_name_ar: string }
      | undefined;
    if (!emp) {
      res.status(404).json({ error: 'الموظف المحدد غير موجود.' });
      return;
    }

    const lt = db.prepare('SELECT code, name_ar FROM leave_types WHERE code = ? AND is_active = 1').get(typeCode) as
      | { code: string; name_ar: string }
      | undefined;
    if (!lt) {
      res.status(400).json({ error: 'نوع الإجازة المحدد غير متاح أو غير مفعّل.' });
      return;
    }

    const dur = calculateLeaveDuration(String(startDate), String(endDate));
    if (!dur.valid || !dur.days) {
      res.status(400).json({ error: dur.error || 'تواريخ الإجازة غير صالحة.' });
      return;
    }

    const country = String(destinationCountry || '').trim();
    const city = String(destinationCity || '').trim();
    if (typeCode === 'outside_iraq' && !country) {
      res.status(400).json({ error: 'يرجى تحديد بلد الوجهة لطلبات إجازة خارج العراق.' });
      return;
    }

    const existingLeaves = db
      .prepare(`SELECT id, employee_id, start_date, end_date, status FROM leave_requests WHERE employee_id = ?`)
      .all(empId) as Array<{ id: number; employee_id: number; start_date: string; end_date: string; status: string }>;

    const conflict = findConflictingLeave(
      existingLeaves.map((l) => ({
        id: l.id,
        employeeId: l.employee_id,
        startDate: l.start_date,
        endDate: l.end_date,
        status: l.status,
      })),
      empId,
      String(startDate),
      String(endDate)
    );
    if (conflict) {
      res.status(409).json({
        error: `يوجد تداخل مع طلب إجازة آخر للموظف خلال الفترة (${conflict.startDate} إلى ${conflict.endDate}). يرجى مراجعة التواريخ.`,
      });
      return;
    }

    const computedDestination =
      String(destination || '').trim() ||
      (country && city ? `${city} - ${country}` : country || city || '');
    const subDate = String(submissionDate || new Date().toISOString().slice(0, 10)).slice(0, 10);

    const r = db
      .prepare(
        `INSERT INTO leave_requests (
          employee_id, leave_type_code, start_date, end_date, days_count,
          destination, destination_country, destination_city, travel_notes, submission_date,
          reason, file_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        empId,
        typeCode,
        String(startDate),
        String(endDate),
        dur.days,
        computedDestination,
        country,
        city,
        String(travelNotes || '').trim(),
        subDate,
        String(reason || '').trim(),
        fileId ? Number(fileId) : null
      );

    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'CREATE',
      module: 'leaves',
      recordRef: String(r.lastInsertRowid),
      description: `تقديم طلب ${lt.name_ar} للموظف ${emp.full_name_ar} لمدة ${dur.days} يوم (${startDate} إلى ${endDate}).`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ id: Number(r.lastInsertRowid), daysCount: dur.days });
  });

  router.post('/leaves/:id/decision', requireAuth, requirePermission('leaves', 'approve'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, decisionNotes } = req.body || {};
    if (status !== 'approved' && status !== 'rejected') {
      res.status(400).json({ error: 'القرار يجب أن يكون موافقة أو رفضاً.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'طلب الإجازة غير موجود.' });
      return;
    }
    db.prepare(
      `UPDATE leave_requests SET status = ?, decision_notes = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`
    ).run(status, String(decisionNotes || ''), req.user!.fullNameAr, id);

    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: status === 'approved' ? 'APPROVE' : 'REJECT',
      module: 'leaves',
      recordRef: String(id),
      description: `${status === 'approved' ? 'اعتماد' : 'رفض'} طلب الإجازة رقم ${id}.`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  // ======================== EQUIPMENT ========================
  router.get('/equipment', requireAuth, requirePermission('equipment', 'read'), (req: AuthedRequest, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT q.*, e.full_name_ar as custodian_name
         FROM equipment q
         LEFT JOIN employees e ON e.id = q.custodian_id
         WHERE q.archived = 0
         ORDER BY q.equipment_code ASC`
      )
      .all() as Array<Record<string, unknown>>;

    const transfers = db
      .prepare(
        `SELECT t.*, q.name_ar as equipment_name FROM equipment_transfers t
         JOIN equipment q ON q.id = t.equipment_id
         ORDER BY t.transfer_date DESC LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        equipmentCode: String(r.equipment_code),
        nameAr: String(r.name_ar),
        nameEn: String(r.name_en || ''),
        category: String(r.category),
        manufacturer: String(r.manufacturer || ''),
        model: String(r.model || ''),
        serialNumber: String(r.serial_number || ''),
        assetNumber: String(r.asset_number || ''),
        acquisitionDate: String(r.acquisition_date || ''),
        purchaseInfo: String(r.purchase_info || ''),
        location: String(r.location || ''),
        custodianId: r.custodian_id ? Number(r.custodian_id) : null,
        custodianName: r.custodian_name ? String(r.custodian_name) : 'غير محدد',
        status: r.status,
        warrantyExpiry: String(r.warranty_expiry || ''),
        notes: String(r.notes || ''),
        archived: Boolean(r.archived),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      })),
      transfers: transfers.map((t) => ({
        id: Number(t.id),
        equipmentId: Number(t.equipment_id),
        equipmentName: String(t.equipment_name),
        fromLocation: String(t.from_location),
        toLocation: String(t.to_location),
        fromCustodian: String(t.from_custodian || ''),
        toCustodian: String(t.to_custodian || ''),
        transferDate: String(t.transfer_date),
        reason: String(t.reason || ''),
        recordedBy: String(t.recorded_by),
      })),
    });
  });

  router.post('/equipment', requireAuth, requirePermission('equipment', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.equipmentCode || !b.nameAr || !b.category) {
      res.status(400).json({ error: 'يرجى إدخال رمز الجهاز واسمه والتصنيف.' });
      return;
    }
    try {
      const r = db
        .prepare(
          `INSERT INTO equipment (
            equipment_code, name_ar, name_en, category, manufacturer, model,
            serial_number, asset_number, acquisition_date, purchase_info, location,
            custodian_id, status, warranty_expiry, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(b.equipmentCode).trim(),
          String(b.nameAr).trim(),
          String(b.nameEn || ''),
          String(b.category),
          String(b.manufacturer || ''),
          String(b.model || ''),
          String(b.serialNumber || ''),
          String(b.assetNumber || ''),
          String(b.acquisitionDate || ''),
          String(b.purchaseInfo || ''),
          String(b.location || ''),
          b.custodianId ? Number(b.custodianId) : null,
          String(b.status || 'operational'),
          String(b.warrantyExpiry || ''),
          String(b.notes || '')
        );
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'CREATE',
        module: 'equipment',
        recordRef: String(b.equipmentCode),
        description: `إضافة أصل/جهاز جديد: ${b.nameAr}`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ id: Number(r.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'رمز الجهاز مسجل مسبقاً.' });
    }
  });

  router.put('/equipment/:id', requireAuth, requirePermission('equipment', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const b = req.body || {};
    const existing = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'الجهاز غير موجود.' });
      return;
    }
    db.prepare(
      `UPDATE equipment SET
        equipment_code = ?, name_ar = ?, name_en = ?, category = ?, manufacturer = ?, model = ?,
        serial_number = ?, asset_number = ?, acquisition_date = ?, purchase_info = ?, location = ?,
        custodian_id = ?, status = ?, warranty_expiry = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      String(b.equipmentCode || existing.equipment_code),
      String(b.nameAr || existing.name_ar),
      String(b.nameEn ?? existing.name_en ?? ''),
      String(b.category || existing.category),
      String(b.manufacturer ?? existing.manufacturer ?? ''),
      String(b.model ?? existing.model ?? ''),
      String(b.serialNumber ?? existing.serial_number ?? ''),
      String(b.assetNumber ?? existing.asset_number ?? ''),
      String(b.acquisitionDate ?? existing.acquisition_date ?? ''),
      String(b.purchaseInfo ?? existing.purchase_info ?? ''),
      String(b.location ?? existing.location ?? ''),
      b.custodianId !== undefined ? (b.custodianId ? Number(b.custodianId) : null) : existing.custodian_id,
      String(b.status || existing.status),
      String(b.warrantyExpiry ?? existing.warranty_expiry ?? ''),
      String(b.notes ?? existing.notes ?? ''),
      id
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'UPDATE',
      module: 'equipment',
      recordRef: String(b.equipmentCode || existing.equipment_code),
      description: `تحديث سجل الجهاز: ${b.nameAr || existing.name_ar}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  router.post('/equipment/:id/transfer', requireAuth, requirePermission('equipment', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { toLocation, toCustodianId, transferDate, reason } = req.body || {};
    const eq = db
      .prepare(`SELECT q.*, e.full_name_ar as custodian_name FROM equipment q LEFT JOIN employees e ON e.id = q.custodian_id WHERE q.id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!eq || !toLocation) {
      res.status(400).json({ error: 'يرجى تحديد الجهاز والموقع الجديد.' });
      return;
    }
    const newCustodianRow = toCustodianId
      ? (db.prepare('SELECT full_name_ar FROM employees WHERE id = ?').get(Number(toCustodianId)) as { full_name_ar: string } | undefined)
      : undefined;

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO equipment_transfers (equipment_id, from_location, to_location, from_custodian, to_custodian, transfer_date, reason, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        String(eq.location || 'غير محدد'),
        String(toLocation),
        String(eq.custodian_name || 'غير محدد'),
        newCustodianRow?.full_name_ar || String(eq.custodian_name || 'غير محدد'),
        String(transferDate || new Date().toISOString().slice(0, 10)),
        String(reason || ''),
        req.user!.fullNameAr
      );
      db.prepare(`UPDATE equipment SET location = ?, custodian_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
        String(toLocation),
        toCustodianId ? Number(toCustodianId) : eq.custodian_id,
        id
      );
    });
    tx();
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'TRANSFER',
      module: 'equipment',
      recordRef: String(eq.equipment_code),
      description: `نقل الجهاز ${eq.name_ar} إلى ${toLocation}.`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ ok: true });
  });

  // ======================== MAINTENANCE & CALIBRATION ========================
  router.get('/maintenance', requireAuth, requirePermission('maintenance', 'read'), (_req, res) => {
    const db = getDb();
    const maint = db
      .prepare(
        `SELECT m.*, q.equipment_code, q.name_ar as equipment_name
         FROM maintenance_records m JOIN equipment q ON q.id = m.equipment_id
         ORDER BY m.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const cals = db
      .prepare(
        `SELECT c.*, q.equipment_code, q.name_ar as equipment_name, f.original_name as file_name
         FROM calibration_records c
         JOIN equipment q ON q.id = c.equipment_id
         LEFT JOIN uploaded_files f ON f.id = c.file_id
         ORDER BY c.due_date ASC`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      maintenance: maint.map((m) => ({
        id: Number(m.id),
        workOrderNo: String(m.work_order_no),
        equipmentId: Number(m.equipment_id),
        equipmentCode: String(m.equipment_code),
        equipmentName: String(m.equipment_name),
        maintenanceType: m.maintenance_type,
        requesterName: String(m.requester_name),
        assignedTo: String(m.assigned_to || ''),
        priority: m.priority,
        startDate: String(m.start_date),
        expectedEndDate: String(m.expected_end_date),
        actualEndDate: m.actual_end_date ? String(m.actual_end_date) : null,
        description: String(m.description),
        spareParts: String(m.spare_parts || ''),
        costAmount: m.cost_amount !== null ? Number(m.cost_amount) : null,
        status: m.status,
        notes: String(m.notes || ''),
        createdAt: String(m.created_at),
      })),
      calibrations: cals.map((c) => ({
        id: Number(c.id),
        equipmentId: Number(c.equipment_id),
        equipmentCode: String(c.equipment_code),
        equipmentName: String(c.equipment_name),
        calibrationDate: String(c.calibration_date),
        dueDate: String(c.due_date),
        provider: String(c.provider),
        certificateNumber: String(c.certificate_number),
        inspectionDate: String(c.inspection_date || ''),
        status: c.status,
        responsiblePerson: String(c.responsible_person),
        notes: String(c.notes || ''),
        fileId: c.file_id ? Number(c.file_id) : null,
        fileName: c.file_name ? String(c.file_name) : null,
        createdAt: String(c.created_at),
      })),
    });
  });

  router.post('/maintenance', requireAuth, requirePermission('maintenance', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.equipmentId || !b.description || !b.startDate || !b.expectedEndDate) {
      res.status(400).json({ error: 'يرجى استكمال بيانات أمر الصيانة المطلوبة.' });
      return;
    }
    const woNo = String(b.workOrderNo || `WO-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`);
    db.prepare(
      `INSERT INTO maintenance_records (
        work_order_no, equipment_id, maintenance_type, requester_name, assigned_to,
        priority, start_date, expected_end_date, description, spare_parts, cost_amount, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      woNo,
      Number(b.equipmentId),
      String(b.maintenanceType || 'corrective'),
      String(b.requesterName || req.user!.fullNameAr),
      String(b.assignedTo || ''),
      String(b.priority || 'medium'),
      String(b.startDate),
      String(b.expectedEndDate),
      String(b.description),
      String(b.spareParts || ''),
      b.costAmount ? Number(b.costAmount) : null,
      String(b.status || 'open'),
      String(b.notes || '')
    );

    if (b.maintenanceType === 'breakdown' || b.status === 'in_progress') {
      db.prepare(`UPDATE equipment SET status = 'under_maintenance', updated_at = datetime('now') WHERE id = ?`).run(
        Number(b.equipmentId)
      );
    }

    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'CREATE',
      module: 'maintenance',
      recordRef: woNo,
      description: `فتح أمر عمل صيانة ${woNo}.`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ workOrderNo: woNo });
  });

  router.patch('/maintenance/:id', requireAuth, requirePermission('maintenance', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, actualEndDate, spareParts, costAmount, notes } = req.body || {};
    const existing = db.prepare('SELECT * FROM maintenance_records WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'أمر الصيانة غير موجود.' });
      return;
    }
    db.prepare(
      `UPDATE maintenance_records SET status = ?, actual_end_date = ?, spare_parts = ?, cost_amount = ?, notes = ? WHERE id = ?`
    ).run(
      String(status || existing.status),
      status === 'completed' ? actualEndDate || new Date().toISOString().slice(0, 10) : existing.actual_end_date,
      String(spareParts ?? existing.spare_parts ?? ''),
      costAmount !== undefined ? (costAmount === '' || costAmount === null ? null : Number(costAmount)) : existing.cost_amount,
      String(notes ?? existing.notes ?? ''),
      id
    );
    if (status === 'completed') {
      db.prepare(`UPDATE equipment SET status = 'operational', updated_at = datetime('now') WHERE id = ?`).run(
        Number(existing.equipment_id)
      );
    }
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'UPDATE',
      module: 'maintenance',
      recordRef: String(existing.work_order_no),
      description: `تحديث حالة أمر الصيانة ${existing.work_order_no} إلى ${status}.`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  router.post('/calibrations', requireAuth, requirePermission('calibrations', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.equipmentId || !b.calibrationDate || !b.dueDate || !b.provider || !b.certificateNumber) {
      res.status(400).json({ error: 'يرجى استكمال حقول سجل المعايرة الإلزامية.' });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const derivedStatus =
      b.status || (String(b.dueDate) < today ? 'overdue' : 'valid');

    db.prepare(
      `INSERT INTO calibration_records (
        equipment_id, calibration_date, due_date, provider, certificate_number,
        inspection_date, status, responsible_person, notes, file_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      Number(b.equipmentId),
      String(b.calibrationDate),
      String(b.dueDate),
      String(b.provider),
      String(b.certificateNumber),
      String(b.inspectionDate || b.calibrationDate),
      String(derivedStatus),
      String(b.responsiblePerson || req.user!.fullNameAr),
      String(b.notes || ''),
      b.fileId ? Number(b.fileId) : null
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'CREATE',
      module: 'calibrations',
      recordRef: String(b.certificateNumber),
      description: `تسجيل شهادة معايرة رقم ${b.certificateNumber}.`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ ok: true });
  });

  // ======================== DOCUMENTS ARCHIVE ========================
  router.get('/documents', requireAuth, requirePermission('documents', 'read'), (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT d.*, e.full_name_ar as emp_name, q.name_ar as eq_name,
                f.original_name as file_name, f.size_bytes as file_size, f.mime_type as file_mime
         FROM documents d
         LEFT JOIN employees e ON e.id = d.related_employee_id
         LEFT JOIN equipment q ON q.id = d.related_equipment_id
         LEFT JOIN uploaded_files f ON f.id = d.file_id
         ORDER BY d.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        docNumber: String(r.doc_number),
        title: String(r.title),
        category: String(r.category),
        referenceNumber: String(r.reference_number || ''),
        creationDate: String(r.creation_date),
        submissionDate: String(r.submission_date || ''),
        author: String(r.author),
        responsiblePerson: String(r.responsible_person || ''),
        relatedEmployeeId: r.related_employee_id ? Number(r.related_employee_id) : null,
        relatedEquipmentId: r.related_equipment_id ? Number(r.related_equipment_id) : null,
        relatedEmployeeName: r.emp_name ? String(r.emp_name) : null,
        relatedEquipmentName: r.eq_name ? String(r.eq_name) : null,
        description: String(r.description || ''),
        tags: String(r.tags || ''),
        status: r.status,
        revisionNo: Number(r.revision_no),
        approvedBy: r.approved_by ? String(r.approved_by) : null,
        approvedAt: r.approved_at ? String(r.approved_at) : null,
        reviewDueDate: r.review_due_date ? String(r.review_due_date) : null,
        fileId: r.file_id ? Number(r.file_id) : null,
        fileName: r.file_name ? String(r.file_name) : null,
        fileSize: r.file_size ? Number(r.file_size) : null,
        fileMime: r.file_mime ? String(r.file_mime) : null,
        createdAt: String(r.created_at),
      })),
    });
  });

  router.post('/documents', requireAuth, requirePermission('documents', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.title || !b.category) {
      res.status(400).json({ error: 'يرجى إدخال عنوان الوثيقة والتصنيف.' });
      return;
    }
    const docNo = String(b.docNumber || `DOC-PVT-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`);
    const today = new Date().toISOString().slice(0, 10);
    try {
      const r = db
        .prepare(
          `INSERT INTO documents (
            doc_number, title, category, reference_number, creation_date, submission_date,
            author, responsible_person, related_employee_id, related_equipment_id,
            description, tags, status, revision_no, review_due_date, file_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          docNo,
          String(b.title).trim(),
          String(b.category),
          String(b.referenceNumber || ''),
          String(b.creationDate || today),
          String(b.submissionDate || today),
          String(b.author || req.user!.fullNameAr),
          String(b.responsiblePerson || req.user!.fullNameAr),
          b.relatedEmployeeId ? Number(b.relatedEmployeeId) : null,
          b.relatedEquipmentId ? Number(b.relatedEquipmentId) : null,
          String(b.description || ''),
          String(b.tags || ''),
          req.user!.role === 'manager' && b.status ? String(b.status) : 'under_review',
          Math.max(1, Number(b.revisionNo) || 1),
          b.reviewDueDate ? String(b.reviewDueDate) : null,
          b.fileId ? Number(b.fileId) : null
        );
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'CREATE',
        module: 'documents',
        recordRef: docNo,
        description: `أرشفة وثيقة جديدة: ${b.title}`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ id: Number(r.lastInsertRowid), docNumber: docNo });
    } catch {
      res.status(409).json({ error: 'رقم الوثيقة مسجل مسبقاً.' });
    }
  });

  router.patch('/documents/:id/status', requireAuth, requirePermission('documents', 'approve'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, bumpRevision } = req.body || {};
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!doc) {
      res.status(404).json({ error: 'الوثيقة غير موجودة.' });
      return;
    }
    const nextRev = bumpRevision ? Number(doc.revision_no) + 1 : Number(doc.revision_no);
    db.prepare(
      `UPDATE documents SET status = ?, revision_no = ?, approved_by = ?, approved_at = ? WHERE id = ?`
    ).run(
      String(status || doc.status),
      nextRev,
      status === 'approved' ? req.user!.fullNameAr : doc.approved_by,
      status === 'approved' ? new Date().toISOString().slice(0, 10) : doc.approved_at,
      id
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'STATUS_CHANGE',
      module: 'documents',
      recordRef: String(doc.doc_number),
      description: `تحديث حالة الوثيقة ${doc.doc_number} إلى ${status} (إصدار ${nextRev}).`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  // ======================== CORRESPONDENCE ========================
  router.get('/correspondence', requireAuth, requirePermission('correspondence', 'read'), (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.*, f.original_name as file_name
         FROM correspondence c
         LEFT JOIN uploaded_files f ON f.id = c.file_id
         ORDER BY c.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    res.json({
      items: rows.map((c) => ({
        id: Number(c.id),
        refNumber: String(c.ref_number),
        correspondenceType: c.correspondence_type,
        subject: String(c.subject),
        sender: String(c.sender),
        recipient: String(c.recipient),
        receivedDate: String(c.received_date || ''),
        dispatchDate: String(c.dispatch_date || ''),
        relatedDepartment: String(c.related_department || ''),
        responsibleEmployee: String(c.responsible_employee || ''),
        priority: c.priority,
        requiredAction: String(c.required_action || ''),
        dueDate: String(c.due_date || ''),
        status: c.status,
        notes: String(c.notes || ''),
        fileId: c.file_id ? Number(c.file_id) : null,
        fileName: c.file_name ? String(c.file_name) : null,
        createdAt: String(c.created_at),
      })),
    });
  });

  router.post('/correspondence', requireAuth, requirePermission('correspondence', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.refNumber || !b.subject || !b.sender || !b.recipient) {
      res.status(400).json({ error: 'يرجى استكمال الرقم الإشاري والموضوع والمرسل والمستلم.' });
      return;
    }
    try {
      db.prepare(
        `INSERT INTO correspondence (
          ref_number, correspondence_type, subject, sender, recipient,
          received_date, dispatch_date, related_department, responsible_employee,
          priority, required_action, due_date, status, notes, file_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        String(b.refNumber).trim(),
        String(b.correspondenceType || 'incoming'),
        String(b.subject).trim(),
        String(b.sender).trim(),
        String(b.recipient).trim(),
        String(b.receivedDate || ''),
        String(b.dispatchDate || ''),
        String(b.relatedDepartment || ''),
        String(b.responsibleEmployee || req.user!.fullNameAr),
        String(b.priority || 'medium'),
        String(b.requiredAction || ''),
        String(b.dueDate || ''),
        String(b.status || 'open'),
        String(b.notes || ''),
        b.fileId ? Number(b.fileId) : null
      );
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'CREATE',
        module: 'correspondence',
        recordRef: String(b.refNumber),
        description: `تسجيل مراسلة جديدة (${b.refNumber}): ${b.subject}`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ ok: true });
    } catch {
      res.status(409).json({ error: 'الرقم الإشاري للمراسلة مستخدم مسبقاً.' });
    }
  });

  router.patch('/correspondence/:id', requireAuth, requirePermission('correspondence', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, notes } = req.body || {};
    const existing = db.prepare('SELECT * FROM correspondence WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'المراسلة غير موجودة.' });
      return;
    }
    db.prepare(`UPDATE correspondence SET status = ?, notes = ? WHERE id = ?`).run(
      String(status || existing.status),
      String(notes ?? existing.notes ?? ''),
      id
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'UPDATE',
      module: 'correspondence',
      recordRef: String(existing.ref_number),
      description: `تحديث حالة المراسلة ${existing.ref_number} إلى ${status}.`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  // ======================== INVENTORY & CHEMICAL MATERIALS LEDGER ========================
  router.get('/inventory', requireAuth, requirePermission('inventory', 'read'), (_req, res) => {
    const db = getDb();
    const items = db
      .prepare(
        `SELECT i.*,
                sds.original_name as sds_file_name,
                doc.original_name as doc_file_name
         FROM inventory_items i
         LEFT JOIN uploaded_files sds ON sds.id = i.sds_file_id
         LEFT JOIN uploaded_files doc ON doc.id = i.doc_file_id
         ORDER BY i.is_chemical DESC, i.item_code ASC`
      )
      .all() as Array<Record<string, unknown>>;

    const transactions = db
      .prepare(
        `SELECT t.*, i.item_code, i.name_ar as item_name, i.name_en as item_name_en, i.is_chemical
         FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id
         ORDER BY t.id DESC LIMIT 300`
      )
      .all() as Array<Record<string, unknown>>;

    const categories = db
      .prepare(`SELECT * FROM inventory_categories WHERE is_active = 1 ORDER BY is_chemical DESC, id ASC`)
      .all() as Array<Record<string, unknown>>;

    res.json({
      categories: categories.map((c) => ({
        id: Number(c.id),
        nameAr: String(c.name_ar),
        nameEn: String(c.name_en || ''),
        isChemical: Boolean(c.is_chemical),
        isActive: Boolean(c.is_active),
      })),
      items: items.map((i) => {
        const cap = i.container_capacity !== null && i.container_capacity !== undefined ? Number(i.container_capacity) : null;
        const qty = Number(i.quantity);
        const unit = String(i.container_unit || 'L');
        const computedTotal =
          cap !== null && cap > 0
            ? computeTotalChemicalVolume(qty, cap, unit).totalVolume
            : i.total_volume !== null && i.total_volume !== undefined
            ? Number(i.total_volume)
            : null;
        return {
          id: Number(i.id),
          itemCode: String(i.item_code),
          nameAr: String(i.name_ar),
          nameEn: String(i.name_en || ''),
          category: String(i.category),
          isChemical: Boolean(i.is_chemical) || String(i.category) === CHEMICAL_CATEGORY_AR,
          description: String(i.description || ''),
          manufacturer: String(i.manufacturer || ''),
          grade: String(i.grade || ''),
          unit: String(i.unit),
          quantity: qty,
          containerCapacity: cap,
          containerUnit: unit,
          totalVolume: computedTotal,
          minStock: Number(i.min_stock),
          storageLocation: String(i.storage_location || ''),
          supplier: String(i.supplier || ''),
          purchaseDate: String(i.purchase_date || ''),
          expiryDate: i.expiry_date ? String(i.expiry_date) : null,
          responsiblePerson: String(i.responsible_person || ''),
          notes: String(i.notes || ''),
          sdsFileId: i.sds_file_id ? Number(i.sds_file_id) : null,
          sdsFileName: i.sds_file_name ? String(i.sds_file_name) : null,
          docFileId: i.doc_file_id ? Number(i.doc_file_id) : null,
          docFileName: i.doc_file_name ? String(i.doc_file_name) : null,
          updatedAt: String(i.updated_at),
        };
      }),
      transactions: transactions.map((t) => ({
        id: Number(t.id),
        itemId: Number(t.item_id),
        itemCode: String(t.item_code),
        itemName: String(t.item_name),
        itemNameEn: String(t.item_name_en || ''),
        isChemical: Boolean(t.is_chemical),
        txType: t.tx_type,
        quantityDelta: Number(t.quantity_delta),
        balanceAfter: Number(t.balance_after),
        containersCount: t.containers_count !== null && t.containers_count !== undefined ? Number(t.containers_count) : null,
        containerCapacity: t.container_capacity !== null && t.container_capacity !== undefined ? Number(t.container_capacity) : null,
        volumeDelta: t.volume_delta !== null && t.volume_delta !== undefined ? Number(t.volume_delta) : null,
        totalVolumeAfter: t.total_volume_after !== null && t.total_volume_after !== undefined ? Number(t.total_volume_after) : null,
        volumeUnit: String(t.volume_unit || ''),
        employeeName: String(t.employee_name || ''),
        fromLocation: String(t.from_location || ''),
        toLocation: String(t.to_location || ''),
        referenceNo: String(t.reference_no || ''),
        reason: String(t.reason),
        performedBy: String(t.performed_by),
        createdAt: String(t.created_at),
      })),
    });
  });

  router.post('/inventory/categories', requireAuth, requirePermission('settings', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const { nameAr, nameEn, isChemical } = req.body || {};
    const cleanAr = String(nameAr || '').trim();
    if (!cleanAr || cleanAr.length < 2) {
      res.status(400).json({ error: 'يرجى إدخال اسم التصنيف المخزني بالعربية.' });
      return;
    }
    try {
      const r = db
        .prepare(`INSERT INTO inventory_categories (name_ar, name_en, is_chemical, is_active) VALUES (?, ?, ?, 1)`)
        .run(cleanAr, String(nameEn || '').trim(), isChemical ? 1 : 0);
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'CREATE',
        module: 'inventory',
        recordRef: cleanAr,
        description: `إضافة تصنيف مخزني جديد: ${cleanAr}.`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ id: Number(r.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'هذا التصنيف مسجل مسبقاً.' });
    }
  });

  router.post('/inventory', requireAuth, requirePermission('inventory', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.itemCode || !b.nameAr || !b.category) {
      res.status(400).json({ error: 'يرجى إدخال رمز الصنف واسمه والتصنيف.' });
      return;
    }

    const categoryStr = String(b.category).trim();
    const isChemical = Boolean(b.isChemical) || categoryStr === CHEMICAL_CATEGORY_AR;
    const initQty = Math.max(0, Number(b.quantity) || 0);
    const capNum = b.containerCapacity !== undefined && b.containerCapacity !== null && b.containerCapacity !== ''
      ? Number(b.containerCapacity)
      : null;

    if (isChemical && (!capNum || !Number.isFinite(capNum) || capNum <= 0)) {
      res.status(400).json({ error: 'يرجى تحديد حجم/سعة العبوة للمادة الكيمياوية (قيمة موجبة أكبر من صفر).' });
      return;
    }

    const containerUnit = String(b.containerUnit || 'L').trim() || 'L';
    const totalVolume = isChemical && capNum ? computeTotalChemicalVolume(initQty, capNum, containerUnit).totalVolume : null;

    try {
      const tx = db.transaction(() => {
        db.prepare(`INSERT OR IGNORE INTO inventory_categories (name_ar, is_chemical, is_active) VALUES (?, ?, 1)`).run(
          categoryStr,
          isChemical ? 1 : 0
        );

        const r = db
          .prepare(
            `INSERT INTO inventory_items (
              item_code, name_ar, name_en, category, is_chemical, description,
              manufacturer, grade, unit, quantity, container_capacity, container_unit, total_volume,
              min_stock, storage_location, supplier, purchase_date, expiry_date,
              responsible_person, notes, sds_file_id, doc_file_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            String(b.itemCode).trim(),
            String(b.nameAr).trim(),
            String(b.nameEn || '').trim(),
            categoryStr,
            isChemical ? 1 : 0,
            String(b.description || '').trim(),
            String(b.manufacturer || '').trim(),
            String(b.grade || '').trim(),
            isChemical ? 'عبوة' : String(b.unit || 'قطعة'),
            initQty,
            capNum,
            containerUnit,
            totalVolume,
            Math.max(0, Number(b.minStock) || 0),
            String(b.storageLocation || '').trim(),
            String(b.supplier || '').trim(),
            String(b.purchaseDate || new Date().toISOString().slice(0, 10)),
            b.expiryDate ? String(b.expiryDate) : null,
            String(b.responsiblePerson || req.user!.fullNameAr).trim(),
            String(b.notes || '').trim(),
            b.sdsFileId ? Number(b.sdsFileId) : null,
            b.docFileId ? Number(b.docFileId) : null
          );
        const itemId = Number(r.lastInsertRowid);
        if (initQty > 0) {
          db.prepare(
            `INSERT INTO inventory_transactions (
              item_id, tx_type, quantity_delta, balance_after,
              containers_count, container_capacity, volume_delta, total_volume_after, volume_unit,
              employee_name, reference_no, reason, performed_by
            ) VALUES (?, 'receipt', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            itemId,
            initQty,
            initQty,
            isChemical ? initQty : null,
            capNum,
            totalVolume,
            totalVolume,
            isChemical ? containerUnit : '',
            String(b.responsiblePerson || req.user!.fullNameAr).trim(),
            String(b.referenceNo || 'INIT'),
            'تسجيل رصيد افتتاحي للصنف الجديد',
            req.user!.fullNameAr
          );
        }
        return itemId;
      });
      const itemId = tx();
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'CREATE',
        module: 'inventory',
        recordRef: String(b.itemCode),
        description: `إضافة ${isChemical ? 'مادة كيمياوية' : 'صنف مخزني'}: ${b.nameAr} (رصيد: ${initQty}${totalVolume !== null ? ` — الحجم الكلي: ${totalVolume} ${formatVolumeUnitAr(containerUnit)}` : ''}).`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ id: itemId, totalVolume });
    } catch {
      res.status(409).json({ error: 'رمز الصنف المخزني مسجل مسبقاً.' });
    }
  });

  // Update item metadata ONLY (business rule: stock balance is NEVER modified directly outside transactions)
  router.put('/inventory/:id', requireAuth, requirePermission('inventory', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'الصنف المخزني غير موجود.' });
      return;
    }
    const b = req.body || {};
    const categoryStr = b.category ? String(b.category).trim() : String(existing.category);
    const isChemical = b.isChemical !== undefined ? Boolean(b.isChemical) : Boolean(existing.is_chemical) || categoryStr === CHEMICAL_CATEGORY_AR;
    const capNum =
      b.containerCapacity !== undefined
        ? b.containerCapacity === null || b.containerCapacity === ''
          ? null
          : Number(b.containerCapacity)
        : existing.container_capacity !== null && existing.container_capacity !== undefined
        ? Number(existing.container_capacity)
        : null;
    if (isChemical && (!capNum || !Number.isFinite(capNum) || capNum <= 0)) {
      res.status(400).json({ error: 'سعة العبوة يجب أن تكون قيمة موجبة أكبر من صفر.' });
      return;
    }
    const containerUnit = b.containerUnit ? String(b.containerUnit).trim() : String(existing.container_unit || 'L');
    const currentQty = Number(existing.quantity);
    const totalVolume = isChemical && capNum ? computeTotalChemicalVolume(currentQty, capNum, containerUnit).totalVolume : null;

    db.prepare(
      `UPDATE inventory_items SET
         name_ar = ?, name_en = ?, category = ?, is_chemical = ?, description = ?,
         manufacturer = ?, grade = ?, container_capacity = ?, container_unit = ?, total_volume = ?,
         min_stock = ?, storage_location = ?, supplier = ?, purchase_date = ?, expiry_date = ?,
         responsible_person = ?, notes = ?, sds_file_id = ?, doc_file_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      b.nameAr ? String(b.nameAr).trim() : String(existing.name_ar),
      b.nameEn !== undefined ? String(b.nameEn).trim() : String(existing.name_en || ''),
      categoryStr,
      isChemical ? 1 : 0,
      b.description !== undefined ? String(b.description).trim() : String(existing.description || ''),
      b.manufacturer !== undefined ? String(b.manufacturer).trim() : String(existing.manufacturer || ''),
      b.grade !== undefined ? String(b.grade).trim() : String(existing.grade || ''),
      capNum,
      containerUnit,
      totalVolume,
      b.minStock !== undefined ? Math.max(0, Number(b.minStock) || 0) : Number(existing.min_stock),
      b.storageLocation !== undefined ? String(b.storageLocation).trim() : String(existing.storage_location || ''),
      b.supplier !== undefined ? String(b.supplier).trim() : String(existing.supplier || ''),
      b.purchaseDate !== undefined ? String(b.purchaseDate) : String(existing.purchase_date || ''),
      b.expiryDate !== undefined ? (b.expiryDate ? String(b.expiryDate) : null) : existing.expiry_date,
      b.responsiblePerson !== undefined ? String(b.responsiblePerson).trim() : String(existing.responsible_person || ''),
      b.notes !== undefined ? String(b.notes).trim() : String(existing.notes || ''),
      b.sdsFileId !== undefined ? (b.sdsFileId ? Number(b.sdsFileId) : null) : existing.sds_file_id,
      b.docFileId !== undefined ? (b.docFileId ? Number(b.docFileId) : null) : existing.doc_file_id,
      id
    );

    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'UPDATE',
      module: 'inventory',
      recordRef: String(existing.item_code),
      description: `تحديث البيانات الوصفية للصنف ${b.nameAr || existing.name_ar} (دون تعديل الرصيد مباشرة).`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, totalVolume });
  });

  router.post('/inventory/:id/transaction', requireAuth, requirePermission('inventory', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { txType, amount, referenceNo, reason, employeeName, newLocation } = req.body || {};
    if (!['receipt', 'issue', 'adjustment', 'transfer'].includes(String(txType))) {
      res.status(400).json({ error: 'نوع الحركة المخزنية غير صالح (استلام، صرف، تسوية جردية، أو نقل موقع).' });
      return;
    }
    if (!reason || String(reason).trim().length < 3) {
      res.status(400).json({ error: 'يجب توضيح سبب الحركة المخزنية أو الملاحظات.' });
      return;
    }
    if (txType === 'adjustment' && req.user!.role !== 'manager') {
      res.status(403).json({ error: 'حركات التسوية الجردية متاحة لمدير الشعبة فقط.' });
      return;
    }
    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!item) {
      res.status(404).json({ error: 'الصنف المخزني غير موجود.' });
      return;
    }

    const isChem = Boolean(item.is_chemical) || String(item.category) === CHEMICAL_CATEGORY_AR;
    const cap = item.container_capacity !== null && item.container_capacity !== undefined ? Number(item.container_capacity) : null;
    const unit = String(item.container_unit || 'L');

    const calc = computeInventoryTransactionMath({
      currentQty: Number(item.quantity),
      containerCapacity: cap,
      volumeUnit: unit,
      txType: txType as InventoryTxKind,
      amount: Number(amount),
      newLocation: newLocation ? String(newLocation).trim() : undefined,
    });
    if (!calc.valid) {
      res.status(400).json({ error: calc.error });
      return;
    }

    const fromLoc = String(item.storage_location || '');
    const toLoc = txType === 'transfer' ? String(newLocation).trim() : fromLoc;
    const empLabel = String(employeeName || req.user!.fullNameAr).trim();

    const runTx = db.transaction(() => {
      if (txType === 'transfer') {
        db.prepare(`UPDATE inventory_items SET storage_location = ?, updated_at = datetime('now') WHERE id = ?`).run(
          toLoc,
          id
        );
      } else {
        db.prepare(
          `UPDATE inventory_items SET quantity = ?, total_volume = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(calc.newBalance, isChem && cap ? calc.totalVolumeAfter : null, id);
      }
      db.prepare(
        `INSERT INTO inventory_transactions (
          item_id, tx_type, quantity_delta, balance_after,
          containers_count, container_capacity, volume_delta, total_volume_after, volume_unit,
          employee_name, from_location, to_location, reference_no, reason, performed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        txType,
        calc.quantityDelta,
        calc.newBalance,
        isChem ? (txType === 'transfer' ? Number(item.quantity) : Number(amount)) : null,
        cap,
        isChem ? calc.volumeDelta : null,
        isChem ? calc.totalVolumeAfter : null,
        isChem ? unit : '',
        empLabel,
        txType === 'transfer' ? fromLoc : '',
        txType === 'transfer' ? toLoc : '',
        String(referenceNo || '').trim(),
        String(reason).trim(),
        req.user!.fullNameAr
      );
    });
    runTx();

    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'STOCK_TX',
      module: 'inventory',
      recordRef: String(item.item_code),
      description:
        txType === 'transfer'
          ? `نقل موقع التخزين للصنف ${item.name_ar} من (${fromLoc || 'غير محدد'}) إلى (${toLoc}).`
          : `حركة مخزنية (${txType}) للصنف ${item.name_ar}: تغير ${calc.quantityDelta} ← الرصيد الجديد ${calc.newBalance}${isChem && cap ? ` (الحجم الكلي: ${calc.totalVolumeAfter} ${formatVolumeUnitAr(unit)})` : ''}.`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({
      newBalance: calc.newBalance,
      totalVolumeAfter: isChem && cap ? calc.totalVolumeAfter : null,
      storageLocation: toLoc,
    });
  });

  // ======================== PROCUREMENT & ADMIN REQUESTS ========================
  router.get('/requests', requireAuth, requirePermission('requests', 'read'), (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM admin_requests ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    res.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        requestNumber: String(r.request_number),
        requestType: r.request_type,
        title: String(r.title),
        requesterName: String(r.requester_name),
        description: String(r.description),
        justification: String(r.justification || ''),
        priority: r.priority,
        submissionDate: String(r.submission_date),
        status: r.status,
        managerName: r.manager_name ? String(r.manager_name) : null,
        decisionNotes: String(r.decision_notes || ''),
        createdAt: String(r.created_at),
      })),
    });
  });

  router.post('/requests', requireAuth, requirePermission('requests', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.title || !b.description) {
      res.status(400).json({ error: 'يرجى إدخال عنوان الطلب وتفاصيله.' });
      return;
    }
    const reqNo = `REQ-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    db.prepare(
      `INSERT INTO admin_requests (
        request_number, request_type, title, requester_name, description, justification,
        priority, submission_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      reqNo,
      String(b.requestType || 'administrative'),
      String(b.title).trim(),
      String(b.requesterName || req.user!.fullNameAr),
      String(b.description).trim(),
      String(b.justification || ''),
      String(b.priority || 'medium'),
      new Date().toISOString().slice(0, 10),
      b.status === 'draft' ? 'draft' : 'submitted'
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'CREATE',
      module: 'requests',
      recordRef: reqNo,
      description: `إنشاء طلب إداري/مشتريات جديد (${reqNo}): ${b.title}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ requestNumber: reqNo });
  });

  router.post('/requests/:id/decision', requireAuth, requirePermission('requests', 'approve'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, decisionNotes } = req.body || {};
    const valid = ['under_review', 'approved', 'rejected', 'completed'];
    if (!valid.includes(String(status))) {
      res.status(400).json({ error: 'حالة الاعتماد غير صالحة.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM admin_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'الطلب غير موجود.' });
      return;
    }
    db.prepare(
      `UPDATE admin_requests SET status = ?, manager_name = ?, decision_notes = ? WHERE id = ?`
    ).run(String(status), req.user!.fullNameAr, String(decisionNotes || ''), id);
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'DECISION',
      module: 'requests',
      recordRef: String(existing.request_number),
      description: `تحديث حالة الطلب ${existing.request_number} إلى (${status}).`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  // ======================== MEETINGS & TASKS ========================
  router.get('/meetings-tasks', requireAuth, requirePermission('meetings', 'read'), (_req, res) => {
    const db = getDb();
    const meetings = db.prepare('SELECT * FROM meetings ORDER BY meeting_date DESC').all() as Array<Record<string, unknown>>;
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY due_date ASC').all() as Array<Record<string, unknown>>;

    res.json({
      meetings: meetings.map((m) => ({
        id: Number(m.id),
        meetingNumber: String(m.meeting_number),
        title: String(m.title),
        meetingDate: String(m.meeting_date),
        location: String(m.location || ''),
        agenda: String(m.agenda || ''),
        attendees: String(m.attendees || ''),
        minutes: String(m.minutes || ''),
        decisions: String(m.decisions || ''),
        status: m.status,
        createdBy: String(m.created_by),
        createdAt: String(m.created_at),
      })),
      tasks: tasks.map((t) => ({
        id: Number(t.id),
        title: String(t.title),
        description: String(t.description || ''),
        assignedTo: String(t.assigned_to),
        priority: t.priority,
        startDate: String(t.start_date),
        dueDate: String(t.due_date),
        status: t.status,
        relatedMeetingId: t.related_meeting_id ? Number(t.related_meeting_id) : null,
        completionNotes: String(t.completion_notes || ''),
        createdBy: String(t.created_by),
        createdAt: String(t.created_at),
      })),
    });
  });

  router.post('/meetings', requireAuth, requirePermission('meetings', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.title || !b.meetingDate) {
      res.status(400).json({ error: 'يرجى إدخال عنوان الاجتماع وتاريخه.' });
      return;
    }
    const mtgNo = `MTG-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    db.prepare(
      `INSERT INTO meetings (meeting_number, title, meeting_date, location, agenda, attendees, minutes, decisions, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      mtgNo,
      String(b.title).trim(),
      String(b.meetingDate),
      String(b.location || ''),
      String(b.agenda || ''),
      String(b.attendees || ''),
      String(b.minutes || ''),
      String(b.decisions || ''),
      String(b.status || 'scheduled'),
      req.user!.fullNameAr
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'CREATE',
      module: 'meetings',
      recordRef: mtgNo,
      description: `توثيق اجتماع جديد: ${b.title}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ meetingNumber: mtgNo });
  });

  router.post('/tasks', requireAuth, requirePermission('tasks', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.title || !b.assignedTo || !b.dueDate) {
      res.status(400).json({ error: 'يرجى إدخال عنوان المهمة والموظف المكلف وتاريخ الاستحقاق.' });
      return;
    }
    const r = db
      .prepare(
        `INSERT INTO tasks (title, description, assigned_to, priority, start_date, due_date, status, related_meeting_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(b.title).trim(),
        String(b.description || ''),
        String(b.assignedTo).trim(),
        String(b.priority || 'medium'),
        String(b.startDate || new Date().toISOString().slice(0, 10)),
        String(b.dueDate),
        String(b.status || 'pending'),
        b.relatedMeetingId ? Number(b.relatedMeetingId) : null,
        req.user!.fullNameAr
      );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'CREATE',
      module: 'tasks',
      recordRef: `TASK-${r.lastInsertRowid}`,
      description: `إنشاء مهمة داخلية: ${b.title}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  router.patch('/tasks/:id', requireAuth, requirePermission('tasks', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, completionNotes } = req.body || {};
    db.prepare(`UPDATE tasks SET status = ?, completion_notes = ? WHERE id = ?`).run(
      String(status || 'in_progress'),
      String(completionNotes || ''),
      id
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'UPDATE',
      module: 'tasks',
      recordRef: `TASK-${id}`,
      description: `تحديث حالة المهمة #${id} إلى ${status}.`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  // ======================== TRAINING & SAFETY (HSE) ========================
  router.get('/training', requireAuth, requirePermission('training', 'read'), (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM training_records ORDER BY start_date DESC').all() as Array<Record<string, unknown>>;
    res.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        courseTitle: String(r.course_title),
        provider: String(r.provider),
        location: String(r.location || ''),
        employeeId: r.employee_id ? Number(r.employee_id) : null,
        employeeName: String(r.employee_name),
        startDate: String(r.start_date),
        endDate: String(r.end_date),
        certificateNumber: String(r.certificate_number || ''),
        competencyArea: String(r.competency_area || ''),
        status: r.status,
        notes: String(r.notes || ''),
        createdAt: String(r.created_at),
      })),
    });
  });

  router.post('/training', requireAuth, requirePermission('training', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.courseTitle || !b.provider || !b.employeeName || !b.startDate) {
      res.status(400).json({ error: 'يرجى استكمال اسم الدورة والجهة المنفذة والمشارك وتاريخ البدء.' });
      return;
    }
    db.prepare(
      `INSERT INTO training_records (course_title, provider, location, employee_id, employee_name, start_date, end_date, certificate_number, competency_area, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(b.courseTitle).trim(),
      String(b.provider).trim(),
      String(b.location || ''),
      b.employeeId ? Number(b.employeeId) : null,
      String(b.employeeName).trim(),
      String(b.startDate),
      String(b.endDate || b.startDate),
      String(b.certificateNumber || ''),
      String(b.competencyArea || ''),
      String(b.status || 'planned'),
      String(b.notes || '')
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'CREATE',
      module: 'training',
      recordRef: String(b.courseTitle).slice(0, 40),
      description: `إضافة سجل تدريبي: ${b.courseTitle} (${b.employeeName}).`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ ok: true });
  });

  router.get('/safety', requireAuth, requirePermission('safety', 'read'), (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM safety_records ORDER BY record_date DESC').all() as Array<Record<string, unknown>>;
    res.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        recordNumber: String(r.record_number),
        recordType: r.record_type,
        title: String(r.title),
        recordDate: String(r.record_date),
        location: String(r.location || ''),
        responsibleEmployee: String(r.responsible_employee),
        severity: r.severity,
        description: String(r.description),
        correctiveAction: String(r.corrective_action || ''),
        followUpStatus: r.follow_up_status,
        dueDate: String(r.due_date || ''),
        createdAt: String(r.created_at),
      })),
    });
  });

  router.post('/safety', requireAuth, requirePermission('safety', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.title || !b.description) {
      res.status(400).json({ error: 'يرجى إدخال عنوان سجل السلامة وتفاصيله.' });
      return;
    }
    const recNo = `HSE-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    db.prepare(
      `INSERT INTO safety_records (record_number, record_type, title, record_date, location, responsible_employee, severity, description, corrective_action, follow_up_status, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      recNo,
      String(b.recordType || 'inspection'),
      String(b.title).trim(),
      String(b.recordDate || new Date().toISOString().slice(0, 10)),
      String(b.location || ''),
      String(b.responsibleEmployee || req.user!.fullNameAr),
      String(b.severity || 'low'),
      String(b.description).trim(),
      String(b.correctiveAction || ''),
      String(b.followUpStatus || 'open'),
      String(b.dueDate || '')
    );
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'CREATE',
      module: 'safety',
      recordRef: recNo,
      description: `إضافة سجل سلامة مهنية (${recNo}): ${b.title}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ recordNumber: recNo });
  });

  router.patch('/safety/:id', requireAuth, requirePermission('safety', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { followUpStatus, correctiveAction } = req.body || {};
    db.prepare(`UPDATE safety_records SET follow_up_status = ?, corrective_action = ? WHERE id = ?`).run(
      String(followUpStatus || 'in_progress'),
      String(correctiveAction || ''),
      id
    );
    res.json({ ok: true });
  });

  // ======================== NOTIFICATIONS ========================
  router.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
    const items = getAllAlerts(req.user!.id);
    res.json({ items, unreadCount: items.filter((n) => !n.isRead).length });
  });

  router.post('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    const db = getDb();
    const nid = String(req.params.id);
    db.prepare(
      `INSERT OR IGNORE INTO notification_reads (user_id, notification_id) VALUES (?, ?)`
    ).run(req.user!.id, nid);
    res.json({ ok: true });
  });

  router.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    const db = getDb();
    const items = getAllAlerts(req.user!.id);
    const stmt = db.prepare(`INSERT OR IGNORE INTO notification_reads (user_id, notification_id) VALUES (?, ?)`);
    const tx = db.transaction(() => {
      for (const item of items) {
        stmt.run(req.user!.id, item.id);
      }
    });
    tx();
    res.json({ ok: true });
  });

  // ======================== REPORTS & EXPORTS ========================
  interface ReportQueryFilters {
    from?: string;
    to?: string;
    employeeId?: string;
    leaveTypeCode?: string;
    status?: string;
    section?: string;
    search?: string;
    ids?: string;
    groupBy?: string;
  }

  const LEAVE_STATUS_AR: Record<string, string> = {
    pending: 'قيد المراجعة',
    approved: 'معتمدة',
    rejected: 'مرفوضة',
    cancelled: 'ملغاة',
  };

  const TX_TYPE_AR: Record<string, string> = {
    receipt: 'استلام / توريد',
    issue: 'صرف / سحب',
    adjustment: 'تسوية جردية',
    transfer: 'نقل موقع تخزين',
  };

  function buildExportPayload(moduleKey: string, user: AuthUser, filters: ReportQueryFilters = {}): ExportTablePayload {
    const db = getDb();
    const settings = getSettings(db);
    const todayIso = new Date().toISOString().slice(0, 10);
    const soonIso = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const periodLabel =
      filters.from || filters.to ? `${filters.from || 'البداية'} إلى ${filters.to || 'اليوم'}` : 'كافة السجلات المعتمدة';
    const docCode = `RPT-${moduleKey.toUpperCase()}-${todayIso.replace(/-/g, '')}`;

    if (moduleKey === 'employees') {
      const rows = (db.prepare('SELECT * FROM employees WHERE archived = 0 ORDER BY employee_code ASC').all() as Array<Record<string, unknown>>).map((r) => ({
        code: String(r.employee_code),
        nameAr: String(r.full_name_ar),
        jobTitle: String(r.job_title),
        section: String(r.section),
        qualification: `${r.qualification || ''} — ${r.specialization || ''}`,
        status: String(r.status),
        hireDate: String(r.hire_date || ''),
        phone: String(r.phone || ''),
      }));
      return {
        titleAr: `كشف ملاك موظفي ${settings.divisionNameAr}`,
        subtitleAr: 'تقرير إداري رسمي بمعلومات الكادر الوظيفي والمؤهلات.',
        documentCode: docCode,
        preparedBy: user.fullNameAr,
        periodLabel,
        settings,
        columns: [
          { key: 'code', header: 'الرقم الوظيفي', width: 15 },
          { key: 'nameAr', header: 'الاسم الكامل', width: 28 },
          { key: 'jobTitle', header: 'العنوان الوظيفي', width: 26 },
          { key: 'section', header: 'الوحدة', width: 22 },
          { key: 'qualification', header: 'المؤهل والتخصص', width: 24 },
          { key: 'status', header: 'الحالة', width: 14 },
          { key: 'hireDate', header: 'تاريخ التعيين', width: 14 },
          { key: 'phone', header: 'الهاتف', width: 16 },
        ],
        rows,
      };
    }

    if (moduleKey === 'leaves' || moduleKey === 'leaves_by_type' || moduleKey === 'leaves_by_employee' || moduleKey === 'leaves_summary') {
      const where: string[] = ['1=1'];
      const params: unknown[] = [];

      if (filters.employeeId) {
        where.push('l.employee_id = ?');
        params.push(Number(filters.employeeId));
      }
      if (filters.leaveTypeCode) {
        where.push('l.leave_type_code = ?');
        params.push(filters.leaveTypeCode);
      }
      if (filters.status) {
        where.push('l.status = ?');
        params.push(filters.status);
      }
      if (filters.section) {
        where.push('e.section = ?');
        params.push(filters.section);
      }
      if (filters.from) {
        where.push('l.end_date >= ?');
        params.push(filters.from);
      }
      if (filters.to) {
        where.push('l.start_date <= ?');
        params.push(filters.to);
      }
      if (filters.ids) {
        const parsedIds = filters.ids
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);
        if (parsedIds.length > 0) {
          where.push(`l.id IN (${parsedIds.map(() => '?').join(',')})`);
          params.push(...parsedIds);
        }
      }
      if (filters.search) {
        const q = `%${filters.search.trim()}%`;
        where.push(`(e.full_name_ar LIKE ? OR e.employee_code LIKE ? OR l.reason LIKE ? OR l.destination_country LIKE ?)`);
        params.push(q, q, q, q);
      }

      const rawLeaves = db
        .prepare(
          `SELECT l.*, e.full_name_ar as employee_name, e.employee_code, e.job_title, e.section, lt.name_ar as leave_type_name
           FROM leave_requests l
           JOIN employees e ON e.id = l.employee_id
           LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
           WHERE ${where.join(' AND ')}
           ORDER BY l.start_date DESC, l.id DESC`
        )
        .all(...params) as Array<Record<string, unknown>>;

      const mode = filters.groupBy || (moduleKey === 'leaves_by_type' ? 'type' : moduleKey === 'leaves_by_employee' ? 'employee' : '');

      if (mode === 'type') {
        const grouped = new Map<string, { typeName: string; total: number; approved: number; pending: number; rejected: number; days: number }>();
        for (const r of rawLeaves) {
          const k = String(r.leave_type_name || r.leave_type_code);
          const g = grouped.get(k) || { typeName: k, total: 0, approved: 0, pending: 0, rejected: 0, days: 0 };
          g.total += 1;
          if (r.status === 'approved') {
            g.approved += 1;
            g.days += Number(r.days_count);
          } else if (r.status === 'pending') {
            g.pending += 1;
          } else if (r.status === 'rejected') {
            g.rejected += 1;
          }
          grouped.set(k, g);
        }
        return {
          titleAr: 'تقرير الإجازات المجمّع حسب نوع الإجازة',
          subtitleAr: `إحصائية شاملة لطلبات الإجازات وأيام الإجازة المعتمدة في ${settings.divisionNameAr}.`,
          documentCode: docCode,
          preparedBy: user.fullNameAr,
          periodLabel,
          settings,
          columns: [
            { key: 'typeName', header: 'نوع الإجازة', width: 28 },
            { key: 'total', header: 'إجمالي الطلبات', width: 16 },
            { key: 'approved', header: 'المعتمدة', width: 14 },
            { key: 'pending', header: 'المعلقة', width: 14 },
            { key: 'rejected', header: 'المرفوضة', width: 14 },
            { key: 'days', header: 'مجموع الأيام المعتمدة', width: 20 },
          ],
          rows: Array.from(grouped.values()),
        };
      }

      if (mode === 'employee') {
        const grouped = new Map<
          string,
          { code: string; name: string; section: string; total: number; approved: number; pending: number; days: number; outsideIraq: number }
        >();
        for (const r of rawLeaves) {
          const k = String(r.employee_code);
          const g = grouped.get(k) || {
            code: k,
            name: String(r.employee_name),
            section: String(r.section || ''),
            total: 0,
            approved: 0,
            pending: 0,
            days: 0,
            outsideIraq: 0,
          };
          g.total += 1;
          if (r.status === 'approved') {
            g.approved += 1;
            g.days += Number(r.days_count);
          } else if (r.status === 'pending') {
            g.pending += 1;
          }
          if (r.leave_type_code === 'outside_iraq') g.outsideIraq += 1;
          grouped.set(k, g);
        }
        return {
          titleAr: 'تقرير الإجازات المجمّع حسب الموظف',
          subtitleAr: `ملخص طلبات وأيام الإجازات لكل موظف في ${settings.divisionNameAr}.`,
          documentCode: docCode,
          preparedBy: user.fullNameAr,
          periodLabel,
          settings,
          columns: [
            { key: 'code', header: 'الرقم الوظيفي', width: 15 },
            { key: 'name', header: 'اسم الموظف', width: 28 },
            { key: 'section', header: 'الوحدة', width: 22 },
            { key: 'total', header: 'إجمالي الطلبات', width: 14 },
            { key: 'approved', header: 'المعتمدة', width: 12 },
            { key: 'pending', header: 'المعلقة', width: 12 },
            { key: 'days', header: 'الأيام المعتمدة', width: 15 },
            { key: 'outsideIraq', header: 'خارج العراق', width: 14 },
          ],
          rows: Array.from(grouped.values()),
        };
      }

      const rows = rawLeaves.map((r) => {
        const destParts = [r.destination_country, r.destination_city].filter(Boolean).join(' - ');
        const destDisplay = destParts || String(r.destination || '—');
        return {
          code: String(r.employee_code),
          name: String(r.employee_name),
          jobTitle: String(r.job_title || ''),
          type: String(r.leave_type_name || r.leave_type_code),
          startDate: String(r.start_date),
          endDate: String(r.end_date),
          days: Number(r.days_count),
          destination: r.leave_type_code === 'outside_iraq' || destParts ? destDisplay : '—',
          submissionDate: String(r.submission_date || String(r.created_at).slice(0, 10)),
          status: LEAVE_STATUS_AR[String(r.status)] || String(r.status),
          notes: String(r.decision_notes || r.reason || '—'),
        };
      });

      const titleAr =
        filters.employeeId && rawLeaves.length > 0
          ? `سجل إجازات الموظف: ${rawLeaves[0].employee_name} (${rawLeaves[0].employee_code})`
          : moduleKey === 'leaves_summary'
          ? 'ملخص سجل إجازات الموظفين للفترة المحددة'
          : 'السجل الرسمي لإجازات موظفي الشعبة';

      return {
        titleAr,
        subtitleAr: `تقرير رسمي موثق بالإجازات الاعتيادية والمرضية والطارئة وإجازات خارج العراق — ${settings.divisionNameAr}.`,
        documentCode: docCode,
        preparedBy: user.fullNameAr,
        periodLabel,
        settings,
        columns: [
          { key: 'code', header: 'الرقم الوظيفي', width: 14 },
          { key: 'name', header: 'اسم الموظف', width: 24 },
          { key: 'type', header: 'نوع الإجازة', width: 18 },
          { key: 'startDate', header: 'تاريخ البدء', width: 13 },
          { key: 'endDate', header: 'تاريخ الانتهاء', width: 13 },
          { key: 'days', header: 'عدد الأيام', width: 11 },
          { key: 'destination', header: 'الوجهة (خارج العراق)', width: 18 },
          { key: 'submissionDate', header: 'تاريخ التقديم', width: 13 },
          { key: 'status', header: 'حالة الاعتماد', width: 13 },
          { key: 'notes', header: 'الملاحظات الإدارية', width: 26 },
        ],
        rows,
      };
    }

    if (moduleKey === 'equipment') {
      const rows = (
        db.prepare(`SELECT q.*, e.full_name_ar as custodian FROM equipment q LEFT JOIN employees e ON e.id = q.custodian_id WHERE q.archived = 0 ORDER BY q.equipment_code ASC`).all() as Array<Record<string, unknown>>
      ).map((r) => ({
        code: String(r.equipment_code),
        nameAr: String(r.name_ar),
        category: String(r.category),
        model: `${r.manufacturer || ''} ${r.model || ''}`.trim(),
        serial: String(r.serial_number || ''),
        location: String(r.location || ''),
        custodian: String(r.custodian || 'غير محدد'),
        status: String(r.status),
        warranty: String(r.warranty_expiry || ''),
      }));
      return {
        titleAr: `سجل جرد معدات وأصول ${settings.divisionNameAr}`,
        subtitleAr: 'سجل إداري بالأجهزة التشغيلية ومواقعها والعهد المسؤولة عنها.',
        documentCode: docCode,
        preparedBy: user.fullNameAr,
        periodLabel,
        settings,
        columns: [
          { key: 'code', header: 'رمز الجهاز', width: 15 },
          { key: 'nameAr', header: 'اسم الجهاز', width: 28 },
          { key: 'category', header: 'التصنيف', width: 22 },
          { key: 'model', header: 'المصنّع / الموديل', width: 24 },
          { key: 'serial', header: 'الرقم التسلسلي', width: 18 },
          { key: 'location', header: 'الموقع', width: 20 },
          { key: 'custodian', header: 'صاحب العهدة', width: 22 },
          { key: 'status', header: 'الحالة التشغيلية', width: 16 },
          { key: 'warranty', header: 'انتهاء الضمان', width: 15 },
        ],
        rows,
      };
    }

    if (moduleKey === 'maintenance') {
      const rows = (
        db.prepare(`SELECT m.*, q.name_ar as eq_name FROM maintenance_records m JOIN equipment q ON q.id = m.equipment_id ORDER BY m.start_date DESC`).all() as Array<Record<string, unknown>>
      ).map((r) => ({
        wo: String(r.work_order_no),
        eq: String(r.eq_name),
        type: String(r.maintenance_type),
        assigned: String(r.assigned_to || ''),
        priority: String(r.priority),
        start: String(r.start_date),
        expected: String(r.expected_end_date),
        status: String(r.status),
        cost: r.cost_amount !== null ? String(r.cost_amount) : '—',
      }));
      return {
        titleAr: 'تقرير أعمال الصيانة الوقائية والعلاجية',
        subtitleAr: 'حصر أوامر العمل ومواعيد الإنجاز والتكاليف المسجلة.',
        documentCode: docCode,
        preparedBy: user.fullNameAr,
        periodLabel,
        settings,
        columns: [
          { key: 'wo', header: 'رقم أمر العمل', width: 16 },
          { key: 'eq', header: 'الجهاز', width: 26 },
          { key: 'type', header: 'نوع الصيانة', width: 14 },
          { key: 'assigned', header: 'الجهة المنفذة', width: 22 },
          { key: 'priority', header: 'الأولوية', width: 12 },
          { key: 'start', header: 'البدء', width: 14 },
          { key: 'expected', header: 'الإنجاز المتوقع', width: 14 },
          { key: 'status', header: 'الحالة', width: 14 },
          { key: 'cost', header: 'التكلفة', width: 12 },
        ],
        rows,
      };
    }

    // Chemical Materials & Inventory Reports
    if (
      [
        'chemicals_all',
        'chemicals_balances',
        'chemicals_expired',
        'chemicals_expiring',
        'chemicals_low',
      ].includes(moduleKey)
    ) {
      let where = `(is_chemical = 1 OR category = ?)`;
      const params: unknown[] = [CHEMICAL_CATEGORY_AR];
      let titleAr = 'الجرد الشامل للمواد الكيمياوية';
      let subtitleAr = 'جميع المواد الكيمياوية وسعات العبوات والأحجام الكلية المتوفرة ومواقع التخزين.';

      if (moduleKey === 'chemicals_balances') {
        titleAr = 'تقرير الأرصدة الحالية والحجم الكلي للمواد الكيمياوية';
        subtitleAr = 'خلاصة عدد العبوات وسعة العبوة والحجم الكلي المحسوب لكل مادة كيمياوية.';
      } else if (moduleKey === 'chemicals_expired') {
        where += ` AND expiry_date IS NOT NULL AND expiry_date != '' AND expiry_date < ?`;
        params.push(todayIso);
        titleAr = 'تقرير المواد الكيمياوية منتهية الصلاحية';
        subtitleAr = 'قائمة المواد التي تجاوزت تاريخ الانتهاء المحدد للمتابعة الإدارية.';
      } else if (moduleKey === 'chemicals_expiring') {
        where += ` AND expiry_date IS NOT NULL AND expiry_date != '' AND expiry_date >= ? AND expiry_date <= ?`;
        params.push(todayIso, soonIso);
        titleAr = 'تقرير المواد الكيمياوية القريبة من انتهاء الصلاحية';
        subtitleAr = 'المواد التي تنتهي صلاحيتها خلال 30 يوماً القادمة.';
      } else if (moduleKey === 'chemicals_low') {
        where += ` AND quantity <= min_stock`;
        titleAr = 'تقرير المواد الكيمياوية المنخفضة دون الحد الأدنى';
        subtitleAr = 'الأصناف الكيمياوية التي وصلت أو انخفضت عن الحد الأدنى المعتمد.';
      }

      const items = db
        .prepare(`SELECT * FROM inventory_items WHERE ${where} ORDER BY item_code ASC`)
        .all(...params) as Array<Record<string, unknown>>;

      const rows = items.map((r) => {
        const qty = Number(r.quantity);
        const cap = r.container_capacity ? Number(r.container_capacity) : 0;
        const unit = String(r.container_unit || 'L');
        const vol = computeTotalChemicalVolume(qty, cap, unit);
        const expired = Boolean(r.expiry_date && String(r.expiry_date) < todayIso);
        const low = qty <= Number(r.min_stock);
        const statusLabel = expired ? 'منتهية الصلاحية' : qty === 0 ? 'نافذة' : low ? 'رصيد منخفض' : 'متوفرة';
        return {
          code: String(r.item_code),
          name: r.name_en ? `${r.name_ar} (${r.name_en})` : String(r.name_ar),
          grade: String(r.grade || r.manufacturer || '—'),
          capacity: cap > 0 ? `${cap} ${formatVolumeUnitAr(unit)}` : '—',
          containers: qty,
          totalVol: vol.displayLabel,
          minStock: Number(r.min_stock),
          location: String(r.storage_location || '—'),
          expiry: String(r.expiry_date || '—'),
          status: statusLabel,
        };
      });

      return {
        titleAr,
        subtitleAr,
        documentCode: docCode,
        preparedBy: user.fullNameAr,
        periodLabel,
        settings,
        columns: [
          { key: 'code', header: 'رمز المادة', width: 13 },
          { key: 'name', header: 'اسم المادة الكيمياوية', width: 26 },
          { key: 'grade', header: 'الدرجة / المصنّع', width: 20 },
          { key: 'capacity', header: 'سعة العبوة', width: 13 },
          { key: 'containers', header: 'عدد العبوات', width: 12 },
          { key: 'totalVol', header: 'الحجم الكلي المتوفر', width: 18 },
          { key: 'minStock', header: 'الحد الأدنى', width: 11 },
          { key: 'location', header: 'موقع التخزين', width: 24 },
          { key: 'expiry', header: 'تاريخ الانتهاء', width: 13 },
          { key: 'status', header: 'الحالة', width: 14 },
        ],
        rows,
      };
    }

    if (['chemicals_receipts', 'chemicals_issues', 'chemicals_history'].includes(moduleKey)) {
      const where: string[] = ['1=1'];
      const params: unknown[] = [];
      let titleAr = 'سجل حركات المخزون والمواد الكيمياوية الكامل';
      let subtitleAr = 'توثيق كافة حركات الاستلام والصرف والتسوية ونقل المواقع.';

      if (moduleKey === 'chemicals_receipts') {
        where.push(`(i.is_chemical = 1 OR i.category = ?) AND t.tx_type = 'receipt'`);
        params.push(CHEMICAL_CATEGORY_AR);
        titleAr = 'تقرير استلام وتوريد المواد الكيمياوية';
        subtitleAr = 'جميع مستندات توريد واستلام العبوات الكيمياوية والأحجام المضافة.';
      } else if (moduleKey === 'chemicals_issues') {
        where.push(`(i.is_chemical = 1 OR i.category = ?) AND t.tx_type = 'issue'`);
        params.push(CHEMICAL_CATEGORY_AR);
        titleAr = 'تقرير صرف وسحب المواد الكيمياوية';
        subtitleAr = 'جميع حركات الصرف والسحب من مخزن المواد الكيمياوية والأحجام المصروفة.';
      }
      if (filters.from) {
        where.push(`substr(t.created_at, 1, 10) >= ?`);
        params.push(filters.from);
      }
      if (filters.to) {
        where.push(`substr(t.created_at, 1, 10) <= ?`);
        params.push(filters.to);
      }

      const txs = db
        .prepare(
          `SELECT t.*, i.item_code, i.name_ar as item_name, i.name_en as item_name_en
           FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id
           WHERE ${where.join(' AND ')}
           ORDER BY t.id DESC`
        )
        .all(...params) as Array<Record<string, unknown>>;

      const rows = txs.map((t) => {
        const unitLabel = t.volume_unit ? formatVolumeUnitAr(String(t.volume_unit)) : '';
        return {
          date: String(t.created_at).slice(0, 16),
          code: String(t.item_code),
          name: t.item_name_en ? `${t.item_name} (${t.item_name_en})` : String(t.item_name),
          txType: TX_TYPE_AR[String(t.tx_type)] || String(t.tx_type),
          delta: Number(t.quantity_delta) > 0 ? `+${t.quantity_delta}` : String(t.quantity_delta),
          capacity: t.container_capacity ? `${t.container_capacity} ${unitLabel}` : '—',
          volDelta: t.volume_delta !== null && t.volume_delta !== undefined ? `${t.volume_delta} ${unitLabel}` : '—',
          balanceAfter:
            t.total_volume_after !== null && t.total_volume_after !== undefined
              ? `${t.balance_after} عبوة (${t.total_volume_after} ${unitLabel})`
              : String(t.balance_after),
          employee: String(t.employee_name || t.performed_by),
          ref: String(t.reference_no || '—'),
          reason:
            t.tx_type === 'transfer'
              ? `نقل: ${t.from_location} → ${t.to_location} | ${t.reason}`
              : String(t.reason || '—'),
        };
      });

      return {
        titleAr,
        subtitleAr,
        documentCode: docCode,
        preparedBy: user.fullNameAr,
        periodLabel,
        settings,
        columns: [
          { key: 'date', header: 'التاريخ والوقت', width: 16 },
          { key: 'code', header: 'الرمز', width: 12 },
          { key: 'name', header: 'المادة', width: 24 },
          { key: 'txType', header: 'نوع الحركة', width: 15 },
          { key: 'delta', header: 'العبوات/الكمية', width: 13 },
          { key: 'capacity', header: 'سعة العبوة', width: 13 },
          { key: 'volDelta', header: 'الحجم المتغير', width: 14 },
          { key: 'balanceAfter', header: 'الرصيد بعد الحركة', width: 20 },
          { key: 'employee', header: 'الموظف / المنفذ', width: 18 },
          { key: 'ref', header: 'رقم المستند', width: 14 },
          { key: 'reason', header: 'الملاحظات', width: 24 },
        ],
        rows,
      };
    }

    if (moduleKey === 'inventory') {
      const rows = (db.prepare('SELECT * FROM inventory_items ORDER BY is_chemical DESC, item_code ASC').all() as Array<Record<string, unknown>>).map((r) => {
        const qty = Number(r.quantity);
        const cap = r.container_capacity ? Number(r.container_capacity) : null;
        const unit = String(r.container_unit || 'L');
        const volStr = cap ? computeTotalChemicalVolume(qty, cap, unit).displayLabel : '—';
        return {
          code: String(r.item_code),
          name: r.name_en ? `${r.name_ar} (${r.name_en})` : String(r.name_ar),
          category: String(r.category),
          unit: String(r.unit),
          qty,
          totalVol: volStr,
          minStock: Number(r.min_stock),
          location: String(r.storage_location || ''),
          expiry: String(r.expiry_date || '—'),
        };
      });
      return {
        titleAr: 'كشف جرد المخزون والمواد الكيمياوية والمستهلكات',
        subtitleAr: 'الأرصدة المتوفرة والأحجام الكلية والحدود الدنيا وتواريخ الصلاحية.',
        documentCode: docCode,
        preparedBy: user.fullNameAr,
        periodLabel,
        settings,
        columns: [
          { key: 'code', header: 'رمز الصنف', width: 14 },
          { key: 'name', header: 'اسم المادة', width: 28 },
          { key: 'category', header: 'التصنيف', width: 20 },
          { key: 'unit', header: 'الوحدة', width: 10 },
          { key: 'qty', header: 'الرصيد / العبوات', width: 14 },
          { key: 'totalVol', header: 'الحجم الكلي', width: 16 },
          { key: 'minStock', header: 'الحد الأدنى', width: 12 },
          { key: 'location', header: 'موقع التخزين', width: 22 },
          { key: 'expiry', header: 'تاريخ الصلاحية', width: 14 },
        ],
        rows,
      };
    }

    if (moduleKey === 'correspondence') {
      const rows = (db.prepare('SELECT * FROM correspondence ORDER BY created_at DESC').all() as Array<Record<string, unknown>>).map((r) => ({
        ref: String(r.ref_number),
        type: String(r.correspondence_type),
        subject: String(r.subject),
        sender: String(r.sender),
        recipient: String(r.recipient),
        due: String(r.due_date || '—'),
        status: String(r.status),
      }));
      return {
        titleAr: 'سجل المراسلات الصادرة والواردة والمذكرات الداخلية',
        subtitleAr: 'سجل متابعة الكتب الرسمية وتواريخ الاستحقاق.',
        documentCode: docCode,
        preparedBy: user.fullNameAr,
        periodLabel,
        settings,
        columns: [
          { key: 'ref', header: 'الرقم الإشاري', width: 16 },
          { key: 'type', header: 'النوع', width: 14 },
          { key: 'subject', header: 'الموضوع', width: 34 },
          { key: 'sender', header: 'المرسل', width: 22 },
          { key: 'recipient', header: 'المستلم', width: 22 },
          { key: 'due', header: 'موعد المتابعة', width: 14 },
          { key: 'status', header: 'الحالة', width: 14 },
        ],
        rows,
      };
    }

    // Default: documents archive
    const rows = (db.prepare('SELECT * FROM documents ORDER BY creation_date DESC').all() as Array<Record<string, unknown>>).map((r) => ({
      docNo: String(r.doc_number),
      title: String(r.title),
      category: String(r.category),
      author: String(r.author),
      date: String(r.creation_date),
      rev: `v${r.revision_no}`,
      status: String(r.status),
    }));
    return {
      titleAr: 'فهرس التقارير والوثائق المؤرشفة',
      subtitleAr: 'قائمة الوثائق الرسمية والتقارير الدورية في أرشيف الشعبة.',
      documentCode: docCode,
      preparedBy: user.fullNameAr,
      periodLabel,
      settings,
      columns: [
        { key: 'docNo', header: 'رقم الوثيقة', width: 18 },
        { key: 'title', header: 'عنوان الوثيقة', width: 34 },
        { key: 'category', header: 'التصنيف', width: 20 },
        { key: 'author', header: 'المعدّ', width: 22 },
        { key: 'date', header: 'تاريخ الإنشاء', width: 14 },
        { key: 'rev', header: 'الإصدار', width: 10 },
        { key: 'status', header: 'الحالة', width: 14 },
      ],
      rows,
    };
  }

  function extractReportFilters(query: Request['query']): ReportQueryFilters {
    return {
      from: query.from ? String(query.from) : undefined,
      to: query.to ? String(query.to) : undefined,
      employeeId: query.employeeId ? String(query.employeeId) : undefined,
      leaveTypeCode: query.leaveTypeCode ? String(query.leaveTypeCode) : undefined,
      status: query.status ? String(query.status) : undefined,
      section: query.section ? String(query.section) : undefined,
      search: query.search ? String(query.search) : undefined,
      ids: query.ids ? String(query.ids) : undefined,
      groupBy: query.groupBy ? String(query.groupBy) : undefined,
    };
  }

  router.get('/reports/preview/:module', requireAuth, requirePermission('reports', 'read'), (req: AuthedRequest, res) => {
    const payload = buildExportPayload(String(req.params.module), req.user!, extractReportFilters(req.query));
    res.json(payload);
  });

  router.get('/reports/export/:module/:format', requireAuth, requirePermission('reports', 'export'), async (req: AuthedRequest, res) => {
    try {
      const moduleKey = String(req.params.module);
      const format = String(req.params.format).toLowerCase();
      const payload = buildExportPayload(moduleKey, req.user!, extractReportFilters(req.query));

      writeAuditLog(getDb(), {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'REPORT_EXPORT',
        module: 'reports',
        recordRef: `${moduleKey}.${format}`,
        description: `تصدير تقرير (${payload.titleAr}) بصيغة ${format.toUpperCase()}.`,
        ipAddress: getClientIp(req),
      });

      if (format === 'xlsx') {
        const buffer = await generateRtlExcelBuffer(payload);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${payload.documentCode}.xlsx"`);
        res.send(buffer);
        return;
      }

      if (format === 'docx') {
        const buffer = await generateRtlWordBuffer(payload);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${payload.documentCode}.docx"`);
        res.send(buffer);
        return;
      }

      res.status(400).json({ error: 'صيغة التصدير غير مدعومة (استخدم xlsx أو docx أو الطباعة المباشرة PDF).' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل إنشاء التقرير.' });
    }
  });

  router.get('/admin/config-status', requireAuth, requirePermission('settings', 'read'), (_req, res) => {
    const cfg = loadAppConfig();
    const paths = getAppPaths();
    res.json({
      host: cfg.host,
      port: cfg.port,
      nodeEnv: cfg.nodeEnv,
      instanceDir: paths.instanceDir,
      backupRetentionCount: cfg.backupRetentionCount,
      autoBackupIntervalHours: cfg.autoBackupIntervalHours,
      sessionSecretSource: cfg.hasEnvSessionSecret ? 'env' : 'auto_generated_persisted',
      adminInitialPasswordConfigured: cfg.hasEnvAdminInitialPassword,
    });
  });

  // ======================== SYSTEM ADMIN: USERS, SETTINGS, AUDIT, BACKUPS ========================
  router.get('/admin/users', requireAuth, requirePermission('users', 'read'), (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    res.json({ items: rows.map(mapUserRow) });
  });

  router.post('/admin/users', requireAuth, requirePermission('users', 'create'), (req: AuthedRequest, res) => {
    const db = getDb();
    const { username, password, fullNameAr, fullNameEn, role, jobTitle, email } = req.body || {};
    const cleanUser = String(username || '').trim().toLowerCase();
    if (!cleanUser || !/^[a-z0-9._-]{3,40}$/.test(cleanUser) || !fullNameAr) {
      res.status(400).json({ error: 'يرجى إدخال اسم مستخدم صالح (أحرف إنجليزية) والاسم الكامل بالعربية.' });
      return;
    }
    if (!['manager', 'engineer', 'viewer'].includes(String(role))) {
      res.status(400).json({ error: 'الدور الوظيفي المحدد غير صالح.' });
      return;
    }
    const policy = validatePasswordPolicy(String(password || ''));
    if (!policy.valid) {
      res.status(400).json({ error: policy.error });
      return;
    }
    try {
      const r = db
        .prepare(
          `INSERT INTO users (username, password_hash, full_name_ar, full_name_en, role, job_title, email, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          cleanUser,
          hashPassword(String(password)),
          String(fullNameAr).trim(),
          String(fullNameEn || '').trim(),
          String(role),
          String(jobTitle || ''),
          String(email || '')
        );
      writeAuditLog(db, {
        username: req.user!.username,
        userRole: req.user!.role,
        action: 'USER_CREATE',
        module: 'users',
        recordRef: cleanUser,
        description: `إنشاء حساب مستخدم جديد: ${cleanUser} بصلاحية (${role}).`,
        ipAddress: getClientIp(req),
      });
      const created = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid) as Record<string, unknown>;
      res.status(201).json(mapUserRow(created));
    } catch {
      res.status(409).json({ error: 'اسم المستخدم مسجل مسبقاً في النظام.' });
    }
  });

  router.patch('/admin/users/:id', requireAuth, requirePermission('users', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { role, isActive, newPassword, jobTitle } = req.body || {};
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }
    if (id === req.user!.id && isActive === false) {
      res.status(400).json({ error: 'لا يمكنك تعطيل حسابك النشط حالياً.' });
      return;
    }

    if (newPassword) {
      const policy = validatePasswordPolicy(String(newPassword));
      if (!policy.valid) {
        res.status(400).json({ error: policy.error });
        return;
      }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(newPassword)), id);
    }

    db.prepare(`UPDATE users SET role = ?, is_active = ?, job_title = ? WHERE id = ?`).run(
      role && ['manager', 'engineer', 'viewer'].includes(String(role)) ? String(role) : existing.role,
      isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active,
      jobTitle !== undefined ? String(jobTitle) : existing.job_title,
      id
    );

    if (isActive === false) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }

    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'USER_UPDATE',
      module: 'users',
      recordRef: String(existing.username),
      description: `تحديث صلاحيات/حالة الحساب: ${existing.username}.`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  router.get('/admin/settings', requireAuth, (req: AuthedRequest, res) => {
    res.json(getSettings(getDb()));
  });

  router.put('/admin/settings', requireAuth, requirePermission('settings', 'update'), (req: AuthedRequest, res) => {
    const db = getDb();
    const updated = saveSettings(db, req.body || {});
    writeAuditLog(db, {
      username: req.user!.username,
      userRole: req.user!.role,
      action: 'SETTINGS_UPDATE',
      module: 'settings',
      recordRef: 'general',
      description: 'تحديث إعدادات النظام والهوية المؤسسية.',
      ipAddress: getClientIp(req),
    });
    res.json(updated);
  });

  router.get('/admin/audit-logs', requireAuth, requirePermission('audit', 'read'), (req: AuthedRequest, res) => {
    const db = getDb();
    const moduleFilter = String(req.query.module || '');
    const rows = moduleFilter
      ? db.prepare('SELECT * FROM audit_logs WHERE module = ? ORDER BY id DESC LIMIT 300').all(moduleFilter)
      : db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300').all();
    res.json({
      items: (rows as Array<Record<string, unknown>>).map((a) => ({
        id: Number(a.id),
        username: String(a.username),
        userRole: String(a.user_role),
        action: String(a.action),
        module: String(a.module),
        recordRef: String(a.record_ref || ''),
        description: String(a.description),
        ipAddress: String(a.ip_address || ''),
        createdAt: String(a.created_at),
      })),
    });
  });

  router.get('/admin/backups', requireAuth, requirePermission('backups', 'read'), (_req, res) => {
    res.json({ items: listBackups() });
  });

  router.post('/admin/backups', requireAuth, requirePermission('backups', 'create'), async (req: AuthedRequest, res) => {
    try {
      const entry = await createBackup('manual', req.user!.username);
      res.status(201).json(entry);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل إنشاء النسخة الاحتياطية.' });
    }
  });

  router.get('/admin/backups/:id/verify', requireAuth, requirePermission('backups', 'read'), (req: AuthedRequest, res) => {
    const result = verifyBackupIntegrity(String(req.params.id));
    res.json({ valid: result.valid, reason: result.reason || null });
  });

  router.post('/admin/backups/:id/restore', requireAuth, requirePermission('backups', 'update'), async (req: AuthedRequest, res) => {
    try {
      const result = await restoreFromBackup(String(req.params.id), req.user!.username);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشلت عملية الاستعادة.' });
    }
  });

  return router;
}
