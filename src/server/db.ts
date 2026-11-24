import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { SystemSettings } from '../shared/types';
import { ensureAppPaths, loadAppConfig, type AppPaths } from './config';
import { CHEMICAL_CATEGORY_AR, OFFICIAL_DIVISION_NAME_AR } from './domainHelpers';
import { hashPassword, validatePasswordPolicy } from './security';

export type { AppPaths };

export function getAppPaths(): AppPaths {
  return ensureAppPaths();
}

export const DEFAULT_SETTINGS: SystemSettings = {
  companyNameAr: 'شركة نفط الجنوب — هيئة المختبرات والبحوث',
  companyNameEn: 'South Oil Company — Laboratories & Research Directorate',
  divisionNameAr: OFFICIAL_DIVISION_NAME_AR,
  divisionNameEn: 'PVT Reservoir Fluids Division',
  reportFooterAr: `وثيقة إدارية داخلية — ${OFFICIAL_DIVISION_NAME_AR} — نظام الإدارة المتكامل`,
  serverHost: loadAppConfig().host,
  serverPort: String(loadAppConfig().port),
  backupRetentionCount: loadAppConfig().backupRetentionCount,
  autoBackupEnabled: true,
  calibrationAlertDays: 30,
  warrantyAlertDays: 60,
  documentCategories: [
    'التقارير اليومية',
    'التقارير الأسبوعية',
    'التقارير الشهرية',
    'التقارير السنوية',
    'التقارير الفنية',
    'التقارير الإدارية',
    'تقارير المعدات',
    'تقارير الصيانة',
    'شهادات المعايرة',
    'محاضر الاجتماعات',
    'المراسلات الداخلية',
    'الكتب الرسمية',
    'الإجراءات والتعليمات',
    'وثائق الموظفين',
  ],
  equipmentCategories: [
    'أجهزة التحليل والقياس الرئيسية',
    'وحدات الضغط والحرارة',
    'مضخات الحقن والتغذية',
    'أجهزة الكروماتوغرافيا والغازات',
    'أسطوانات وأوعية العينات',
    'أجهزة السلامة والمراقبة',
    'معدات مساندة وخدمات',
  ],
};

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = openDatabase();
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } finally {
      dbInstance = null;
    }
  }
}

export function reopenDb(): Database.Database {
  closeDb();
  dbInstance = openDatabase();
  return dbInstance;
}

function openDatabase(): Database.Database {
  const { dbFile } = getAppPaths();
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);
  return db;
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (r) => r.version
    )
  );

  if (!applied.has(1)) {
    const migrateV1 = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          full_name_ar TEXT NOT NULL,
          full_name_en TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL CHECK (role IN ('manager', 'engineer', 'viewer')),
          job_title TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 1,
          last_login_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          ip_address TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS uploaded_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stored_name TEXT NOT NULL UNIQUE,
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          uploaded_by TEXT NOT NULL,
          module TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS employees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_code TEXT NOT NULL UNIQUE,
          full_name_ar TEXT NOT NULL,
          full_name_en TEXT NOT NULL DEFAULT '',
          job_title TEXT NOT NULL,
          section TEXT NOT NULL,
          qualification TEXT NOT NULL DEFAULT '',
          specialization TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'هندسي',
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'seconded', 'suspended', 'retired')),
          hire_date TEXT NOT NULL DEFAULT '',
          birth_date TEXT,
          phone TEXT NOT NULL DEFAULT '',
          extension TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          workplace TEXT NOT NULL DEFAULT '',
          job_description TEXT NOT NULL DEFAULT '',
          emergency_contact TEXT,
          notes TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_employees_code ON employees(employee_code);
        CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
        CREATE INDEX IF NOT EXISTS idx_employees_section ON employees(section);

        CREATE TABLE IF NOT EXISTS attendance_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          work_date TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'on_leave', 'mission', 'holiday')),
          check_in TEXT NOT NULL DEFAULT '',
          check_out TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          recorded_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(employee_id, work_date)
        );
        CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(work_date);

        CREATE TABLE IF NOT EXISTS official_holidays (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          holiday_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS leave_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          name_ar TEXT NOT NULL,
          annual_allowance INTEGER NOT NULL DEFAULT 30,
          requires_attachment INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS leave_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          leave_type_code TEXT NOT NULL REFERENCES leave_types(code),
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          days_count INTEGER NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
          decision_notes TEXT NOT NULL DEFAULT '',
          decided_by TEXT,
          decided_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_leaves_status ON leave_requests(status);
        CREATE INDEX IF NOT EXISTS idx_leaves_employee ON leave_requests(employee_id);

        CREATE TABLE IF NOT EXISTS equipment (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          equipment_code TEXT NOT NULL UNIQUE,
          name_ar TEXT NOT NULL,
          name_en TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL,
          manufacturer TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          serial_number TEXT NOT NULL DEFAULT '',
          asset_number TEXT NOT NULL DEFAULT '',
          acquisition_date TEXT NOT NULL DEFAULT '',
          purchase_info TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          custodian_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'operational' CHECK (status IN ('operational', 'under_maintenance', 'out_of_service', 'under_inspection', 'retired')),
          warranty_expiry TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_equipment_code ON equipment(equipment_code);
        CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);

        CREATE TABLE IF NOT EXISTS equipment_transfers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
          from_location TEXT NOT NULL,
          to_location TEXT NOT NULL,
          from_custodian TEXT NOT NULL DEFAULT '',
          to_custodian TEXT NOT NULL DEFAULT '',
          transfer_date TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          recorded_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS maintenance_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          work_order_no TEXT NOT NULL UNIQUE,
          equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
          maintenance_type TEXT NOT NULL CHECK (maintenance_type IN ('preventive', 'corrective', 'breakdown')),
          requester_name TEXT NOT NULL,
          assigned_to TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
          start_date TEXT NOT NULL,
          expected_end_date TEXT NOT NULL,
          actual_end_date TEXT,
          description TEXT NOT NULL,
          spare_parts TEXT NOT NULL DEFAULT '',
          cost_amount REAL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('scheduled', 'open', 'in_progress', 'completed', 'cancelled')),
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_records(status);
        CREATE INDEX IF NOT EXISTS idx_maintenance_due ON maintenance_records(expected_end_date);

        CREATE TABLE IF NOT EXISTS calibration_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
          calibration_date TEXT NOT NULL,
          due_date TEXT NOT NULL,
          provider TEXT NOT NULL,
          certificate_number TEXT NOT NULL,
          inspection_date TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'due_soon', 'overdue', 'failed')),
          responsible_person TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          file_id INTEGER REFERENCES uploaded_files(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_calibration_due ON calibration_records(due_date);

        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_number TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          category TEXT NOT NULL,
          reference_number TEXT NOT NULL DEFAULT '',
          creation_date TEXT NOT NULL,
          submission_date TEXT NOT NULL DEFAULT '',
          author TEXT NOT NULL,
          responsible_person TEXT NOT NULL DEFAULT '',
          related_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
          related_equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'under_review', 'approved', 'archived')),
          revision_no INTEGER NOT NULL DEFAULT 1,
          approved_by TEXT,
          approved_at TEXT,
          review_due_date TEXT,
          file_id INTEGER REFERENCES uploaded_files(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_documents_number ON documents(doc_number);
        CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);

        CREATE TABLE IF NOT EXISTS correspondence (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ref_number TEXT NOT NULL UNIQUE,
          correspondence_type TEXT NOT NULL CHECK (correspondence_type IN ('incoming', 'outgoing', 'internal_memo', 'official_letter')),
          subject TEXT NOT NULL,
          sender TEXT NOT NULL,
          recipient TEXT NOT NULL,
          received_date TEXT NOT NULL DEFAULT '',
          dispatch_date TEXT NOT NULL DEFAULT '',
          related_department TEXT NOT NULL DEFAULT '',
          responsible_employee TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
          required_action TEXT NOT NULL DEFAULT '',
          due_date TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'archived')),
          notes TEXT NOT NULL DEFAULT '',
          file_id INTEGER REFERENCES uploaded_files(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_correspondence_ref ON correspondence(ref_number);
        CREATE INDEX IF NOT EXISTS idx_correspondence_due ON correspondence(due_date);

        CREATE TABLE IF NOT EXISTS inventory_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_code TEXT NOT NULL UNIQUE,
          name_ar TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          unit TEXT NOT NULL DEFAULT 'قطعة',
          quantity REAL NOT NULL DEFAULT 0,
          min_stock REAL NOT NULL DEFAULT 5,
          storage_location TEXT NOT NULL DEFAULT '',
          supplier TEXT NOT NULL DEFAULT '',
          purchase_date TEXT NOT NULL DEFAULT '',
          expiry_date TEXT,
          responsible_person TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_code ON inventory_items(item_code);

        CREATE TABLE IF NOT EXISTS inventory_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
          tx_type TEXT NOT NULL CHECK (tx_type IN ('receipt', 'issue', 'adjustment')),
          quantity_delta REAL NOT NULL,
          balance_after REAL NOT NULL,
          reference_no TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL,
          performed_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_inv_tx_item ON inventory_transactions(item_id);

        CREATE TABLE IF NOT EXISTS admin_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_number TEXT NOT NULL UNIQUE,
          request_type TEXT NOT NULL CHECK (request_type IN ('purchase', 'equipment', 'consumables', 'maintenance', 'administrative')),
          title TEXT NOT NULL,
          requester_name TEXT NOT NULL,
          description TEXT NOT NULL,
          justification TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
          submission_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'completed')),
          manager_name TEXT,
          decision_notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_requests_status ON admin_requests(status);

        CREATE TABLE IF NOT EXISTS meetings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          meeting_number TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          meeting_date TEXT NOT NULL,
          location TEXT NOT NULL DEFAULT '',
          agenda TEXT NOT NULL DEFAULT '',
          attendees TEXT NOT NULL DEFAULT '',
          minutes TEXT NOT NULL DEFAULT '',
          decisions TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          assigned_to TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
          start_date TEXT NOT NULL,
          due_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue')),
          related_meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
          completion_notes TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

        CREATE TABLE IF NOT EXISTS training_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_title TEXT NOT NULL,
          provider TEXT NOT NULL,
          location TEXT NOT NULL DEFAULT '',
          employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
          employee_name TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          certificate_number TEXT NOT NULL DEFAULT '',
          competency_area TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'enrolled', 'completed', 'cancelled')),
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS safety_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          record_number TEXT NOT NULL UNIQUE,
          record_type TEXT NOT NULL CHECK (record_type IN ('inspection', 'observation', 'incident', 'ppe_distribution', 'safety_training')),
          title TEXT NOT NULL,
          record_date TEXT NOT NULL,
          location TEXT NOT NULL DEFAULT '',
          responsible_employee TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high')),
          description TEXT NOT NULL,
          corrective_action TEXT NOT NULL DEFAULT '',
          follow_up_status TEXT NOT NULL DEFAULT 'open' CHECK (follow_up_status IN ('open', 'in_progress', 'closed')),
          due_date TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS notification_reads (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          notification_id TEXT NOT NULL,
          read_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, notification_id)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          user_role TEXT NOT NULL,
          action TEXT NOT NULL,
          module TEXT NOT NULL,
          record_ref TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL,
          ip_address TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);
      `);

      // Seed default configurable leave types & system settings
      const insertLeaveType = db.prepare(
        `INSERT OR IGNORE INTO leave_types (code, name_ar, annual_allowance, requires_attachment, is_active) VALUES (?, ?, ?, ?, 1)`
      );
      insertLeaveType.run('annual', 'إجازة اعتيادية (سنوية)', 30, 0);
      insertLeaveType.run('sick', 'إجازة مرضية', 15, 1);
      insertLeaveType.run('emergency', 'إجازة طارئة', 7, 0);
      insertLeaveType.run('study', 'إجازة دراسية / تدريبية', 14, 1);

      db.prepare(`INSERT OR IGNORE INTO system_settings (key, value_json) VALUES ('general', ?)`).run(
        JSON.stringify(DEFAULT_SETTINGS)
      );

      db.prepare(`INSERT INTO schema_migrations (version, name) VALUES (1, 'initial_pvt_admin_schema')`).run();
    });
    migrateV1();
  }

  if (!applied.has(2)) {
    const addColIfMissing = (table: string, column: string, definition: string) => {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    };

    const migrateV2 = db.transaction(() => {
      // 1. Users: password change requirement flag (for ADMIN_INITIAL_PASSWORD bootstrap)
      addColIfMissing('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');

      // 2. Leave types: controlled rename of Annual Leave -> Regular Leave (preserving historical FKs) + Outside Iraq Leave
      addColIfMissing('leave_types', 'name_en', `TEXT NOT NULL DEFAULT ''`);
      db.prepare(`UPDATE leave_types SET name_ar = 'إجازة اعتيادية', name_en = 'Regular Leave' WHERE code = 'annual'`).run();
      db.prepare(`UPDATE leave_types SET name_en = 'Sick Leave' WHERE code = 'sick' AND name_en = ''`).run();
      db.prepare(`UPDATE leave_types SET name_en = 'Emergency Leave' WHERE code = 'emergency' AND name_en = ''`).run();
      db.prepare(`UPDATE leave_types SET name_en = 'Study / Training Leave' WHERE code = 'study' AND name_en = ''`).run();
      db.prepare(
        `INSERT OR IGNORE INTO leave_types (code, name_ar, name_en, annual_allowance, requires_attachment, is_active)
         VALUES ('outside_iraq', 'إجازة خارج العراق', 'Leave Outside Iraq', 0, 1, 1)`
      ).run();

      // 3. Leave requests: travel destination, submission date, supporting document attachment
      addColIfMissing('leave_requests', 'destination', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('leave_requests', 'destination_country', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('leave_requests', 'destination_city', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('leave_requests', 'travel_notes', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('leave_requests', 'submission_date', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('leave_requests', 'file_id', `INTEGER REFERENCES uploaded_files(id) ON DELETE SET NULL`);
      db.prepare(`UPDATE leave_requests SET submission_date = substr(created_at, 1, 10) WHERE submission_date = ''`).run();

      // 4. Configurable inventory categories (including Chemical Materials)
      db.exec(`
        CREATE TABLE IF NOT EXISTS inventory_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name_ar TEXT NOT NULL UNIQUE,
          name_en TEXT NOT NULL DEFAULT '',
          is_chemical INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1
        );
      `);
      const insCat = db.prepare(
        `INSERT OR IGNORE INTO inventory_categories (name_ar, name_en, is_chemical, is_active) VALUES (?, ?, ?, 1)`
      );
      insCat.run(CHEMICAL_CATEGORY_AR, 'Chemical Materials', 1);
      insCat.run('قطع غيار ومستهلكات', 'Spare Parts & Consumables', 0);
      insCat.run('معدات وقاية شخصية PPE', 'Personal Protective Equipment', 0);
      insCat.run('قرطاسية ومستلزمات إدارية', 'Office & Administrative Supplies', 0);
      insCat.run('مواد نظافة وخدمات', 'Cleaning & General Supplies', 0);
      db.exec(
        `INSERT OR IGNORE INTO inventory_categories (name_ar, name_en, is_chemical, is_active)
         SELECT DISTINCT category, '', 0, 1 FROM inventory_items WHERE category IS NOT NULL AND trim(category) != ''`
      );

      // 5. Chemical inventory & container volume columns on inventory_items (preserving all existing rows)
      addColIfMissing('inventory_items', 'name_en', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('inventory_items', 'is_chemical', `INTEGER NOT NULL DEFAULT 0`);
      addColIfMissing('inventory_items', 'manufacturer', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('inventory_items', 'grade', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('inventory_items', 'container_capacity', `REAL`);
      addColIfMissing('inventory_items', 'container_unit', `TEXT NOT NULL DEFAULT 'L'`);
      addColIfMissing('inventory_items', 'total_volume', `REAL`);
      addColIfMissing('inventory_items', 'notes', `TEXT NOT NULL DEFAULT ''`);
      addColIfMissing('inventory_items', 'sds_file_id', `INTEGER REFERENCES uploaded_files(id) ON DELETE SET NULL`);
      addColIfMissing('inventory_items', 'doc_file_id', `INTEGER REFERENCES uploaded_files(id) ON DELETE SET NULL`);

      // 6. Upgrade inventory_transactions to support 'transfer' and volume/container/location tracking while preserving 100% of existing rows
      db.exec(`
        CREATE TABLE inventory_transactions_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
          tx_type TEXT NOT NULL CHECK (tx_type IN ('receipt', 'issue', 'adjustment', 'transfer')),
          quantity_delta REAL NOT NULL,
          balance_after REAL NOT NULL,
          containers_count REAL,
          container_capacity REAL,
          volume_delta REAL,
          total_volume_after REAL,
          volume_unit TEXT NOT NULL DEFAULT '',
          employee_name TEXT NOT NULL DEFAULT '',
          from_location TEXT NOT NULL DEFAULT '',
          to_location TEXT NOT NULL DEFAULT '',
          reference_no TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL,
          performed_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO inventory_transactions_v2 (
          id, item_id, tx_type, quantity_delta, balance_after, reference_no, reason, performed_by, created_at
        )
        SELECT id, item_id, tx_type, quantity_delta, balance_after, reference_no, reason, performed_by, created_at
        FROM inventory_transactions;
        DROP TABLE inventory_transactions;
        ALTER TABLE inventory_transactions_v2 RENAME TO inventory_transactions;
        CREATE INDEX IF NOT EXISTS idx_inv_tx_item ON inventory_transactions(item_id);
      `);

      // 7. Seed the 5 predefined Chemical Materials without overwriting or resetting existing inventory
      const todayIso = new Date().toISOString().slice(0, 10);
      const plusDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      const predefinedChemicals = [
        {
          code: 'CHEM-001',
          nameAr: 'الهكسان',
          nameEn: 'Hexane',
          desc: 'مذيب هيدروكربوني نقي للاستخدامات المختبرية والتنظيف التشغيلي.',
          manufacturer: 'Merck / Sigma-Aldrich',
          supplier: 'الشركة العامة للتجهيزات الكيمياوية',
          grade: 'Analytical Grade (99%)',
          capacity: 20,
          unit: 'L',
          qty: 5,
          minStock: 2,
          location: 'مخزن المواد الكيمياوية — خزانة المذيبات C1',
          expiry: plusDays(320),
        },
        {
          code: 'CHEM-002',
          nameAr: 'التولوين',
          nameEn: 'Toluene',
          desc: 'مذيب عضوي عطري نقي لأغراض تنظيف الخلايا والمعدات.',
          manufacturer: 'Honeywell Fluka',
          supplier: 'الشركة العامة للتجهيزات الكيمياوية',
          grade: 'HPLC / Analytical Grade',
          capacity: 20,
          unit: 'L',
          qty: 4,
          minStock: 2,
          location: 'مخزن المواد الكيمياوية — خزانة المذيبات C1',
          expiry: plusDays(210),
        },
        {
          code: 'CHEM-003',
          nameAr: 'النفط الأبيض',
          nameEn: 'White Oil',
          desc: 'زيت معدني نقي عالي الصفاء للاستخدامات الهيدروليكية والمساندة.',
          manufacturer: 'Shell / ExxonMobil',
          supplier: 'مخزن الزيوت والمنتجات النفطية',
          grade: 'Technical / Laboratory Grade',
          capacity: 25,
          unit: 'L',
          qty: 3,
          minStock: 2,
          location: 'مخزن المواد الكيمياوية — قسم الزيوت C2',
          expiry: plusDays(480),
        },
        {
          code: 'CHEM-004',
          nameAr: 'الكلايكول',
          nameEn: 'Glycol',
          desc: 'سائل كلايكول معتمد لمنظومات التبريد والحرارة.',
          manufacturer: 'BASF',
          supplier: 'المجهز الصناعي المعتمد',
          grade: 'Monoethylene Glycol (MEG)',
          capacity: 20,
          unit: 'L',
          qty: 2,
          minStock: 2,
          location: 'مخزن المواد الكيمياوية — قسم السوائل C2',
          expiry: plusDays(25),
        },
        {
          code: 'CHEM-005',
          nameAr: 'زيت الفاكيوم',
          nameEn: 'Vacuum Oil',
          desc: 'زيت مخصص لمضخات التفريغ عالية الأداء.',
          manufacturer: 'Edwards Vacuum',
          supplier: 'مكتب تجهيزات المعدات الدقيقة',
          grade: 'Ultragrade 19',
          capacity: 5,
          unit: 'L',
          qty: 6,
          minStock: 3,
          location: 'مخزن المواد الكيمياوية — رف الزيوت الخاصة C3',
          expiry: plusDays(400),
        },
      ];

      const checkChem = db.prepare(`SELECT id FROM inventory_items WHERE item_code = ?`);
      const insChem = db.prepare(`
        INSERT INTO inventory_items (
          item_code, name_ar, name_en, category, is_chemical, description, manufacturer, supplier,
          grade, unit, quantity, container_capacity, container_unit, total_volume, min_stock,
          storage_location, purchase_date, expiry_date, responsible_person, notes
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'عبوة', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insChemTx = db.prepare(`
        INSERT INTO inventory_transactions (
          item_id, tx_type, quantity_delta, balance_after, containers_count, container_capacity,
          volume_delta, total_volume_after, volume_unit, employee_name, reference_no, reason, performed_by
        ) VALUES (?, 'receipt', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const ch of predefinedChemicals) {
        if (!checkChem.get(ch.code)) {
          const totalVol = ch.qty * ch.capacity;
          const res = insChem.run(
            ch.code,
            ch.nameAr,
            ch.nameEn,
            CHEMICAL_CATEGORY_AR,
            ch.desc,
            ch.manufacturer,
            ch.supplier,
            ch.grade,
            ch.qty,
            ch.capacity,
            ch.unit,
            totalVol,
            ch.minStock,
            ch.location,
            todayIso,
            ch.expiry,
            'أمين مخزن الشعبة',
            'صنف كيمياوي معرّف مسبقاً ضمن تصنيف المواد الكيمياوية.'
          );
          insChemTx.run(
            Number(res.lastInsertRowid),
            ch.qty,
            ch.qty,
            ch.qty,
            ch.capacity,
            totalVol,
            totalVol,
            ch.unit,
            'أمين مخزن الشعبة',
            `INIT-${ch.code}`,
            'تسجيل رصيد افتتاحي للمادة الكيمياوية المعرّفة مسبقاً',
            'system'
          );
        }
      }

      // 8. Update existing system_settings division name cleanly if still using previous default name
      const existingSettingsRow = db
        .prepare(`SELECT value_json FROM system_settings WHERE key = 'general'`)
        .get() as { value_json: string } | undefined;
      if (existingSettingsRow?.value_json) {
        try {
          const parsed = JSON.parse(existingSettingsRow.value_json) as Partial<SystemSettings>;
          let changed = false;
          if (!parsed.divisionNameAr || parsed.divisionNameAr.includes('شعبة موائع المكامن')) {
            parsed.divisionNameAr = OFFICIAL_DIVISION_NAME_AR;
            changed = true;
          }
          if (!parsed.reportFooterAr || parsed.reportFooterAr.includes('شعبة موائع المكامن')) {
            parsed.reportFooterAr = `وثيقة إدارية داخلية — ${OFFICIAL_DIVISION_NAME_AR} — نظام الإدارة المتكامل`;
            changed = true;
          }
          if (parsed.backupRetentionCount === 14) {
            parsed.backupRetentionCount = loadAppConfig().backupRetentionCount;
            changed = true;
          }
          if (changed) {
            db.prepare(
              `UPDATE system_settings SET value_json = ?, updated_at = datetime('now') WHERE key = 'general'`
            ).run(JSON.stringify(parsed));
          }
        } catch {
          // keep existing
        }
      }

      db.prepare(`INSERT INTO schema_migrations (version, name) VALUES (2, 'division_rename_leaves_and_chemicals_v2')`).run();
    });

    migrateV2();
  }
}

/**
 * Uses ADMIN_INITIAL_PASSWORD ONLY during initial bootstrap of a brand-new installation
 * (when zero users exist). Never overwrites or resets an existing admin password and
 * requires the administrator to change the initial password after signing in.
 */
export function bootstrapInitialAdminFromEnv(db: Database.Database, env: NodeJS.ProcessEnv = process.env): boolean {
  const initialPassword = (env.ADMIN_INITIAL_PASSWORD || '').trim();
  if (!initialPassword) return false;

  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) return false;

  const policy = validatePasswordPolicy(initialPassword);
  if (!policy.valid) return false;

  const passwordHash = hashPassword(initialPassword);
  db.prepare(
    `INSERT INTO users (username, password_hash, full_name_ar, full_name_en, role, job_title, email, is_active, must_change_password)
     VALUES ('admin', ?, 'مدير الشعبة', 'Division Manager', 'manager', ?, '', 1, 1)`
  ).run(passwordHash, `مدير ${OFFICIAL_DIVISION_NAME_AR}`);

  writeAuditLog(db, {
    username: 'system',
    userRole: 'manager',
    action: 'ENV_ADMIN_BOOTSTRAP',
    module: 'auth',
    recordRef: 'admin',
    description: 'تم تهيئة حساب المدير الأولي من متغيرات البيئة مع تفعيل إلزامية تغيير كلمة المرور.',
  });
  return true;
}

export function getSettings(db: Database.Database): SystemSettings {
  const row = db.prepare(`SELECT value_json FROM system_settings WHERE key = 'general'`).get() as
    | { value_json: string }
    | undefined;
  if (!row) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value_json) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(db: Database.Database, settings: Partial<SystemSettings>): SystemSettings {
  const merged = { ...getSettings(db), ...settings };
  db.prepare(
    `INSERT INTO system_settings (key, value_json, updated_at) VALUES ('general', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
  ).run(JSON.stringify(merged));
  return merged;
}

export function writeAuditLog(
  db: Database.Database,
  entry: {
    username: string;
    userRole: string;
    action: string;
    module: string;
    recordRef?: string;
    description: string;
    ipAddress?: string;
  }
): void {
  db.prepare(
    `INSERT INTO audit_logs (username, user_role, action, module, record_ref, description, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.username,
    entry.userRole,
    entry.action,
    entry.module,
    entry.recordRef || '',
    entry.description,
    entry.ipAddress || ''
  );
}

/**
 * Optional operational bootstrap data loaded ONLY if explicitly chosen during initial first-run setup
 * when the tables are empty. Never overwrites existing records.
 */
export function seedInitialOperationalData(db: Database.Database, managerName: string): void {
  const empCount = (db.prepare('SELECT COUNT(*) as c FROM employees').get() as { c: number }).c;
  if (empCount > 0) return;

  const today = new Date();
  const fmt = (offsetDays: number) => {
    const d = new Date(today.getTime() + offsetDays * 86400000);
    return d.toISOString().slice(0, 10);
  };

  const runSeed = db.transaction(() => {
    const empStmt = db.prepare(`
      INSERT INTO employees (
        employee_code, full_name_ar, full_name_en, job_title, section,
        qualification, specialization, category, status, hire_date, birth_date,
        phone, extension, email, workplace, job_description, emergency_contact, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const e1 = empStmt.run(
      'PVT-1001',
      'م. حيدر عبد الكريم الموسوي',
      'Eng. Haider A. Al-Mousawi',
      'رئيس مهندسين أقدم — مسؤول شعبة',
      'إدارة الشعبة',
      'ماجستير',
      'هندسة النفط والمكامن',
      'إداري / هندسي',
      'active',
      '2014-03-15',
      '1983-06-12',
      '0770-412-8890',
      '4101',
      'h.almousawi@pvt-div.local',
      'مبنى المختبرات المركزي — الطابق الثاني',
      `الإشراف الإداري العام على ${OFFICIAL_DIVISION_NAME_AR} ومتابعة الخطط والتقارير والاعتمادات.`,
      '0770-412-0011 (أخ)',
      'مسؤول الاعتماد الإداري والفني للشعبة.'
    ).lastInsertRowid as number;

    const e2 = empStmt.run(
      'PVT-1002',
      'م. زينب فاضل الساعدي',
      'Eng. Zainab F. Al-Saadi',
      'مهندس أقدم — مسؤول التوثيق والأرشيف',
      'وحدة التوثيق والتقارير',
      'بكالوريوس',
      'هندسة كيمياوية',
      'هندسي',
      'active',
      '2017-09-01',
      '1990-11-03',
      '0780-551-2341',
      '4108',
      'z.alsaadi@pvt-div.local',
      'مبنى المختبرات المركزي — مكتب الأرشيف 204',
      'إدارة أرشيف التقارير والمراسلات ومتابعة توثيق شهادات المعايرة.',
      '0780-551-9900 (والد)',
      ''
    ).lastInsertRowid as number;

    const e3 = empStmt.run(
      'PVT-1003',
      'م. مصطفى جاسم الكناني',
      'Eng. Mustafa J. Al-Kinani',
      'مهندس صيانة ومتابعة معدات',
      'وحدة المعدات والصيانة',
      'بكالوريوس',
      'هندسة ميكانيك',
      'هندسي',
      'active',
      '2018-02-10',
      '1991-04-19',
      '0771-309-4412',
      '4112',
      'm.alkinani@pvt-div.local',
      'قاعة المعدات الرئيسية — الجناح الشرقي',
      'متابعة جداول الصيانة الوقائية والعلاجية وسجلات المعايرة والعهد.',
      '0771-309-1102 (زوجة)',
      ''
    ).lastInsertRowid as number;

    const e4 = empStmt.run(
      'PVT-1004',
      'أ. سارة علي الخفاجي',
      'Sara A. Al-Khafaji',
      'رئيس ملاحظين — شؤون إدارية ومخزن',
      'الوحدة الإدارية والمخزن',
      'بكالوريوس',
      'إدارة أعمال',
      'إداري',
      'on_leave',
      '2019-06-20',
      '1993-08-25',
      '0772-884-1920',
      '4115',
      's.alkhafaji@pvt-div.local',
      'مكتب المخزن الإداري — الطابق الأرضي',
      'إدارة سجلات المستهلكات وطلبات المشتريات والمراسلات الصادرة والواردة.',
      '0772-884-0099 (أخ)',
      'في إجازة اعتيادية معتمدة.'
    ).lastInsertRowid as number;

    const e5 = empStmt.run(
      'PVT-1005',
      'ف. علي حسين العبيدي',
      'Ali H. Al-Obaidi',
      'فني أول سلامة وجودة',
      'وحدة السلامة والجودة (HSE)',
      'دبلوم تقني',
      'تقنيات النفط والغاز',
      'فني',
      'active',
      '2016-11-05',
      '1989-01-30',
      '0770-663-7741',
      '4120',
      'a.alobaidi@pvt-div.local',
      'مبنى المختبرات المركزي — نقطة السلامة',
      'إعداد سجلات الفحص الدوري للسلامة وتوزيع معدات الوقاية الشخصية PPE.',
      '0770-663-0044 (أب)',
      ''
    ).lastInsertRowid as number;

    // Attendance & Holidays & Leaves
    const attStmt = db.prepare(`
      INSERT INTO attendance_records (employee_id, work_date, status, check_in, check_out, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    attStmt.run(e1, fmt(0), 'present', '07:55', '15:05', 'دوام منتظم', managerName);
    attStmt.run(e2, fmt(0), 'present', '08:00', '15:00', 'دوام منتظم', managerName);
    attStmt.run(e3, fmt(0), 'present', '08:05', '15:10', 'متابعة أمر عمل صيانة', managerName);
    attStmt.run(e4, fmt(0), 'on_leave', '', '', 'إجازة اعتيادية معتمدة', managerName);
    attStmt.run(e5, fmt(0), 'present', '07:50', '15:00', 'جولة تفتيش سلامة صباحية', managerName);

    db.prepare(
      `INSERT INTO official_holidays (title, holiday_date, end_date, notes) VALUES (?, ?, ?, ?)`
    ).run('عطلة رأس السنة الميلادية', `${today.getFullYear() + 1}-01-01`, `${today.getFullYear() + 1}-01-01`, 'عطلة رسمية معتمدة');

    const leaveStmt = db.prepare(`
      INSERT INTO leave_requests (
        employee_id, leave_type_code, start_date, end_date, days_count,
        destination, destination_country, destination_city, travel_notes, submission_date,
        reason, status, decision_notes, decided_by, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    leaveStmt.run(e4, 'annual', fmt(-2), fmt(2), 5, '', '', '', '', fmt(-5), 'إجازة اعتيادية عائلية', 'approved', 'موافق — تم تغطية المهام الإدارية', managerName, fmt(-4));
    leaveStmt.run(e3, 'annual', fmt(10), fmt(13), 4, '', '', '', '', fmt(-1), 'إجازة اعتيادية مخططة', 'pending', '', null, null);
    leaveStmt.run(e2, 'outside_iraq', fmt(20), fmt(26), 7, 'عمّان - الأردن', 'الأردن', 'عمّان', 'سفر عائلي موثق بجواز السفر', fmt(-1), 'إجازة سفر خارج العراق', 'pending', '', null, null);

    // Equipment
    const eqStmt = db.prepare(`
      INSERT INTO equipment (
        equipment_code, name_ar, name_en, category, manufacturer, model,
        serial_number, asset_number, acquisition_date, purchase_info, location,
        custodian_id, status, warranty_expiry, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const q1 = eqStmt.run(
      'EQ-PVT-001',
      'منظومة خلية الضغط العالي الرئيسية',
      'High-Pressure Visual Cell Unit',
      'وحدات الضغط والحرارة',
      'Vinci Technologies',
      'PVT-3000/HP',
      'VN-2021-88412',
      'AST-44019',
      '2021-05-14',
      'عقد تجهيز رقم 2021/14 — الدائرة الفنية',
      'القاعة الرئيسية A1',
      e3,
      'operational',
      fmt(45),
      'العهدة مسجلة باسم وحدة المعدات؛ تخضع لمعايرة دورية سنوية.'
    ).lastInsertRowid as number;

    const q2 = eqStmt.run(
      'EQ-PVT-002',
      'مضخة الحقن الدقيقة المزدوجة',
      'Dual Syringe Metering Pump',
      'مضخات الحقن والتغذية',
      'Chandler Engineering',
      'Quizix QX-6000',
      'CH-2020-55210',
      'AST-41902',
      '2020-08-22',
      'عقد تجهيز رقم 2020/08',
      'القاعة الرئيسية A2',
      e3,
      'under_maintenance',
      fmt(180),
      'بانتظار استبدال طقم موانع التسرب ضمن أمر العمل المفتوح.'
    ).lastInsertRowid as number;

    const q3 = eqStmt.run(
      'EQ-PVT-003',
      'جهاز كروماتوغرافيا الغازات الإداري (أصل مختبري)',
      'Gas Chromatograph System',
      'أجهزة الكروماتوغرافيا والغازات',
      'Agilent Technologies',
      'GC-8890 Series',
      'AG-2022-33109',
      'AST-47210',
      '2022-03-11',
      'عقد تجهيز رقم 2022/03',
      'غرفة التحليل B1',
      e2,
      'operational',
      fmt(365),
      'سجل أصل ومستمسكات معايرة فقط.'
    ).lastInsertRowid as number;

    const q4 = eqStmt.run(
      'EQ-PVT-004',
      'جهاز استشعار وكشف الغازات الثابت',
      'Fixed H2S/CH4 Safety Detector',
      'أجهزة السلامة والمراقبة',
      'Dräger',
      'Polytron 8100',
      'DR-2023-19044',
      'AST-50112',
      '2023-01-19',
      'تجهيز قسم السلامة المهنية',
      'مدخل القاعة الرئيسية ومخزن العينات',
      e5,
      'under_inspection',
      fmt(25),
      'يخضع للفحص الدوري النصف سنوي.'
    ).lastInsertRowid as number;

    db.prepare(`
      INSERT INTO equipment_transfers (equipment_id, from_location, to_location, from_custodian, to_custodian, transfer_date, reason, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(q3, 'المخزن المركزي المؤقت', 'غرفة التحليل B1', 'وحدة الاستلام', 'م. زينب فاضل الساعدي', '2022-04-01', 'تنصيب واستلام عهدة رسمية', managerName);

    // Maintenance
    const maintStmt = db.prepare(`
      INSERT INTO maintenance_records (
        work_order_no, equipment_id, maintenance_type, requester_name, assigned_to,
        priority, start_date, expected_end_date, actual_end_date, description,
        spare_parts, cost_amount, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    maintStmt.run(
      'WO-2026-014',
      q2,
      'corrective',
      'م. مصطفى جاسم الكناني',
      'ورشة الصيانة الدقيقة',
      'high',
      fmt(-10),
      fmt(-3),
      null,
      'استبدال موانع التسرب وفحص صمامات التحكم للمضخة المزدوجة.',
      'طقم O-Rings Viton عدد 2، صمام رجعي 1/8 بوصة',
      1450,
      'in_progress',
      'أمر عمل متأخر بانتظار توريد الصمام الاحتياطي.'
    );
    maintStmt.run(
      'WO-2026-018',
      q1,
      'preventive',
      'م. مصطفى جاسم الكناني',
      'م. مصطفى جاسم الكناني',
      'medium',
      fmt(2),
      fmt(5),
      null,
      'صيانة وقائية دورية ربع سنوية وفحص التوصيلات الخارجية.',
      'زيت هيدروليكي معتمد',
      320,
      'scheduled',
      'مجدولة ضمن الخطة الفصلية.'
    );

    // Calibrations
    const calStmt = db.prepare(`
      INSERT INTO calibration_records (
        equipment_id, calibration_date, due_date, provider, certificate_number,
        inspection_date, status, responsible_person, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    calStmt.run(q1, fmt(-350), fmt(15), 'الجهاز المركزي للتقييس والسيطرة النوعية', 'CERT-2025-8821', fmt(-350), 'due_soon', 'م. مصطفى جاسم الكناني', 'تحتاج تجديد شهادة المعايرة خلال أسبوعين.');
    calStmt.run(q4, fmt(-195), fmt(-5), 'مركز المعايرة الصناعية — البصرة', 'CERT-2026-1042', fmt(-195), 'overdue', 'ف. علي حسين العبيدي', 'تجاوزت الموعد المحدد — يجب جدولة الفحص فوراً.');
    calStmt.run(q3, fmt(-90), fmt(275), 'الوكيل المعتمد للشركة المصنعة', 'CERT-2026-3190', fmt(-90), 'valid', 'م. زينب فاضل الساعدي', 'شهادة سارية المفعول.');

    // Documents
    const docStmt = db.prepare(`
      INSERT INTO documents (
        doc_number, title, category, reference_number, creation_date, submission_date,
        author, responsible_person, related_employee_id, related_equipment_id,
        description, tags, status, revision_no, approved_by, approved_at, review_due_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    docStmt.run(
      'DOC-PVT-2026-041',
      `التقرير الشهري لنشاطات ${OFFICIAL_DIVISION_NAME_AR} — تشرين الأول`,
      'التقارير الشهرية',
      'REF-2026/1044',
      fmt(-18),
      fmt(-16),
      'م. زينب فاضل الساعدي',
      'م. حيدر عبد الكريم الموسوي',
      e2,
      null,
      'ملخص إداري شهري لأعمال الشعبة، حضور الملاك، حالة الأجهزة، والمراسلات المنجزة.',
      'شهري,إداري,إنجاز',
      'approved',
      2,
      managerName,
      fmt(-15),
      fmt(12)
    );
    docStmt.run(
      'DOC-PVT-2026-044',
      'سجل جرد ومعايرة أجهزة القاعة الرئيسية',
      'شهادات المعايرة',
      'REF-2026/1089',
      fmt(-7),
      fmt(-6),
      'م. مصطفى جاسم الكناني',
      'م. مصطفى جاسم الكناني',
      e3,
      q1,
      'ملف توثيق إداري لأرقام الشهادات وتواريخ الاستحقاق للأجهزة التشغيلية.',
      'معايرة,معدات,جرد',
      'under_review',
      1,
      null,
      null,
      fmt(7)
    );
    docStmt.run(
      'DOC-PVT-2026-047',
      'تعليمات السلامة الإدارية واستلام الأسطوانات',
      'الإجراءات والتعليمات',
      'HSE-SOP-09',
      fmt(-30),
      fmt(-28),
      'ف. علي حسين العبيدي',
      'م. حيدر عبد الكريم الموسوي',
      e5,
      q4,
      'ضوابط التوثيق والسلامة الإدارية داخل مرفق الشعبة.',
      'سلامة,إجراءات,HSE',
      'approved',
      3,
      managerName,
      fmt(-25),
      fmt(90)
    );

    // Correspondence
    const corrStmt = db.prepare(`
      INSERT INTO correspondence (
        ref_number, correspondence_type, subject, sender, recipient,
        received_date, dispatch_date, related_department, responsible_employee,
        priority, required_action, due_date, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    corrStmt.run(
      'IN-2026-312',
      'incoming',
      'تعميم تحديث خطة الصيانة السنوية للعام القادم',
      'هيئة المختبرات والبحوث',
      OFFICIAL_DIVISION_NAME_AR,
      fmt(-12),
      '',
      'إدارة الصيانة المركزية',
      'م. مصطفى جاسم الكناني',
      'high',
      'إعداد قائمة الاحتياجات التقديرية وإرسالها قبل الموعد المحدد.',
      fmt(-2),
      'in_progress',
      'مراسلة متأخرة تتطلب المتابعة العاجلة.'
    );
    corrStmt.run(
      'OUT-2026-188',
      'outgoing',
      'طلب تجديد عقود المعايرة السنوية للأجهزة المعتمدة',
      OFFICIAL_DIVISION_NAME_AR,
      'قسم المشتريات والعقود',
      '',
      fmt(-4),
      'العقود والمشتريات',
      'م. زينب فاضل الساعدي',
      'medium',
      'متابعة الموافقة المالية والإحالة.',
      fmt(14),
      'open',
      'مرفق جدول التواريخ والشهادات السابقة.'
    );

    // Inventory & initial receipt ledger transactions
    const invStmt = db.prepare(`
      INSERT INTO inventory_items (
        item_code, name_ar, category, description, unit, quantity, min_stock,
        storage_location, supplier, purchase_date, expiry_date, responsible_person
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const txStmt = db.prepare(`
      INSERT INTO inventory_transactions (item_id, tx_type, quantity_delta, balance_after, reference_no, reason, performed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const i1 = invStmt.run(
      'CON-001',
      'حلقات إحكام مقاومة للحرارة (Viton O-Rings)',
      'قطع غيار ومستهلكات',
      'حلقات قياس 1/4 بوصة للاستبدال الدوري الوقائي',
      'طقم',
      4,
      10,
      'خزانة المخزن A — رف 2',
      'الشركة الوطنية للتجهيزات الصناعية',
      fmt(-90),
      fmt(240),
      'أ. سارة علي الخفاجي'
    ).lastInsertRowid as number;
    txStmt.run(i1, 'receipt', 4, 4, 'GRN-2026-011', 'رصيد افتتاحي مسجل بالمستند المخزني', managerName);

    const i2 = invStmt.run(
      'CON-002',
      'قفازات وقاية مقاومة للمواد الكيمياوية (Nitrile)',
      'معدات وقاية شخصية PPE',
      'عبوة 100 قطعة — قياس متوسط وكبير',
      'علبة',
      18,
      8,
      'خزانة السلامة S1',
      'مكتب تجهيزات السلامة المهنية',
      fmt(-40),
      fmt(20),
      'ف. علي حسين العبيدي'
    ).lastInsertRowid as number;
    txStmt.run(i2, 'receipt', 18, 18, 'GRN-2026-024', 'تجهيز مخزني فصلي للسلامة', managerName);

    const i3 = invStmt.run(
      'CON-003',
      'قرطاسية وأوراق طباعة رسمية A4 (80gsm)',
      'قرطاسية ومستلزمات إدارية',
      'ورق رسمي لتوثيق التقارير والمحاضر الإدارية',
      'رزمة',
      25,
      10,
      'مخزن الإدارة — رف 1',
      'المخزن المركزي للشركة',
      fmt(-20),
      null,
      'أ. سارة علي الخفاجي'
    ).lastInsertRowid as number;
    txStmt.run(i3, 'receipt', 25, 25, 'GRN-2026-030', 'استلام حصة الشهر الإدارية', managerName);

    // Procurement & Administrative Requests
    const reqStmt = db.prepare(`
      INSERT INTO admin_requests (
        request_number, request_type, title, requester_name, description, justification,
        priority, submission_date, status, manager_name, decision_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    reqStmt.run(
      'REQ-2026-052',
      'consumables',
      'طلب شراء أطقم موانع تسرب احتياطية (Viton)',
      'م. مصطفى جاسم الكناني',
      'تأمين 20 طقماً من حلقات الإحكام المعتمدة لتعويض النقص دون الحد الأدنى.',
      'الرصيد الحالي وصل إلى 4 أطقم فقط مع وجود أوامر صيانة مجدولة.',
      'high',
      fmt(-3),
      'submitted',
      null,
      ''
    );
    reqStmt.run(
      'REQ-2026-049',
      'administrative',
      'طلب تخصيص خزانة أرشفة مقاومة للحريق لوثائق المعايرة',
      'م. زينب فاضل الساعدي',
      'خزانة معدنية مؤمنة لحفظ أصول شهادات المعايرة والعقود.',
      'رفع مستوى حفظ الوثائق الورقية المعتمدة وفق معايير الجودة.',
      'medium',
      fmt(-9),
      'approved',
      managerName,
      'موافق — يُرفع لقسم التجهيزات الإدارية.'
    );

    // Meetings & Tasks
    const m1 = db.prepare(`
      INSERT INTO meetings (meeting_number, title, meeting_date, location, agenda, attendees, minutes, decisions, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'MTG-2026-019',
      `الاجتماع الإداري الشهري — ${OFFICIAL_DIVISION_NAME_AR}`,
      fmt(-5),
      'قاعة الاجتماعات — الطابق الثاني',
      '1. مراجعة التقارير الشهرية\n2. متابعة المعايرة والصيانة المتأخرة\n3. توزيع المهام الإدارية',
      'م. حيدر الموسوي، م. زينب الساعدي، م. مصطفى الكناني، ف. علي العبيدي',
      'تمت مناقشة نسب إنجاز الخطط الإدارية وتحديد الأولويات لإنهاء أعمال المعايرة المستحقة.',
      '1. إرسال طلب المشتريات العاجل للقطع الاحتياطية\n2. جدولة معايرة كاشف الغازات خلال أسبوع',
      'completed',
      managerName
    ).lastInsertRowid as number;

    const taskStmt = db.prepare(`
      INSERT INTO tasks (title, description, assigned_to, priority, start_date, due_date, status, related_meeting_id, completion_notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    taskStmt.run(
      'استكمال ملف تجديد معايرة كاشف الغازات الثابت',
      'التنسيق مع مركز المعايرة الصناعية لإصدار الشهادة المحدثة وإرفاقها بالأرشيف.',
      'ف. علي حسين العبيدي',
      'urgent',
      fmt(-6),
      fmt(-1),
      'in_progress',
      m1,
      '',
      managerName
    );
    taskStmt.run(
      'تدقيق سجل الإجازات الاعتيادية والترصيد الفصلي',
      'مراجعة أرصدة الإجازات لكافة موظفي الشعبة قبل نهاية الربع.',
      'م. زينب فاضل الساعدي',
      'medium',
      fmt(-2),
      fmt(6),
      'pending',
      m1,
      '',
      managerName
    );

    // Training & Safety
    db.prepare(`
      INSERT INTO training_records (course_title, provider, location, employee_id, employee_name, start_date, end_date, certificate_number, competency_area, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'إدارة الجودة والأرشفة وفق معيار ISO 17025 (الجانب الإداري)',
      'معهد التدريب النفطي — البصرة',
      'قاعة التدريب المركزية',
      e2,
      'م. زينب فاضل الساعدي',
      fmt(-45),
      fmt(-40),
      'TRN-2026-774',
      'الجودة والتوثيق',
      'completed',
      'أكملت الدورة بتقدير امتياز.'
    );
    db.prepare(`
      INSERT INTO training_records (course_title, provider, location, employee_id, employee_name, start_date, end_date, certificate_number, competency_area, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'تخطيط الصيانة الوقائية وإدارة الأصول الصناعية',
      'مركز التطوير الإداري والهندسي',
      'بغداد — المركز التدريبي',
      e3,
      'م. مصطفى جاسم الكناني',
      fmt(20),
      fmt(24),
      '',
      'إدارة الأصول والصيانة',
      'enrolled',
      'تمت الموافقة الإدارية على الترشيح.'
    );

    db.prepare(`
      INSERT INTO safety_records (record_number, record_type, title, record_date, location, responsible_employee, severity, description, corrective_action, follow_up_status, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'HSE-2026-031',
      'inspection',
      'التفتيش الشهري لطفايات الحريق ومخارج الطوارئ',
      fmt(-8),
      'مبنى الشعبة — القاعات والممرات',
      'ف. علي حسين العبيدي',
      'low',
      'فحص صلاحية الضغط لعدد 8 طفايات والتأكد من خلو الممرات من العوائق.',
      'جميع الطفايات صالحة؛ تم تجديد لوحة إرشادية عند المخرج الشرقي.',
      'closed',
      fmt(-5)
    );
    db.prepare(`
      INSERT INTO safety_records (record_number, record_type, title, record_date, location, responsible_employee, severity, description, corrective_action, follow_up_status, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'HSE-2026-034',
      'ppe_distribution',
      'توزيع نظارات الوقاية والقفازات للدفعة الفصلية',
      fmt(-3),
      'القاعة الرئيسية والمخزن',
      'ف. علي حسين العبيدي',
      'low',
      'تسليم معدات الوقاية الشخصية للفنيين والمهندسين وتوثيق الاستلام.',
      'تم استلام التواقيع وحفظ الكشف.',
      'in_progress',
      fmt(4)
    );

    writeAuditLog(db, {
      username: 'system',
      userRole: 'manager',
      action: 'INITIAL_SEED',
      module: 'admin',
      recordRef: 'bootstrap',
      description: `تم تهيئة البيانات التشغيلية الابتدائية لـ ${OFFICIAL_DIVISION_NAME_AR} بنجاح.`,
    });
  });

  runSeed();
}
