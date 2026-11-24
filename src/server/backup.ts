import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BackupEntry } from '../shared/types';
import { appendOperationalLog, loadAppConfig } from './config';
import { closeDb, getAppPaths, getDb, getSettings, reopenDb, writeAuditLog } from './db';
import { resolveSafePath } from './security';

interface BackupManifest {
  id: string;
  createdAt: string;
  triggerType: 'manual' | 'scheduled' | 'pre_restore';
  dbSha256: string;
  dbSizeBytes: number;
  uploadsCount: number;
  totalSizeBytes: number;
  uploadHashes: Record<string, string>;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function formatTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

export async function createBackup(
  triggerType: 'manual' | 'scheduled' | 'pre_restore',
  actorUsername: string
): Promise<BackupEntry> {
  const paths = getAppPaths();
  const db = getDb();
  const backupId = `pvt_backup_${triggerType}_${formatTimestamp()}_${crypto.randomBytes(2).toString('hex')}`;
  const backupDir = resolveSafePath(paths.backupsDir, backupId);
  const backupUploadsDir = path.join(backupDir, 'uploads');
  const backupDbPath = path.join(backupDir, 'pvt_division.db');

  fs.mkdirSync(backupUploadsDir, { recursive: true });

  // Use SQLite's genuine online backup API while application is live
  await db.backup(backupDbPath);

  // Copy all uploaded files and hash each for integrity verification
  const uploadHashes: Record<string, string> = {};
  let uploadsSize = 0;
  if (fs.existsSync(paths.uploadsDir)) {
    const files = fs.readdirSync(paths.uploadsDir);
    for (const file of files) {
      const src = path.join(paths.uploadsDir, file);
      const stat = fs.statSync(src);
      if (stat.isFile()) {
        const dest = path.join(backupUploadsDir, file);
        fs.copyFileSync(src, dest);
        uploadHashes[file] = sha256File(dest);
        uploadsSize += stat.size;
      }
    }
  }

  const dbStat = fs.statSync(backupDbPath);
  const dbSha256 = sha256File(backupDbPath);
  const createdAt = new Date().toISOString();

  const manifest: BackupManifest = {
    id: backupId,
    createdAt,
    triggerType,
    dbSha256,
    dbSizeBytes: dbStat.size,
    uploadsCount: Object.keys(uploadHashes).length,
    totalSizeBytes: dbStat.size + uploadsSize,
    uploadHashes,
  };

  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  writeAuditLog(db, {
    username: actorUsername,
    userRole: 'manager',
    action: 'BACKUP_CREATE',
    module: 'backups',
    recordRef: backupId,
    description: `إنشاء نسخة احتياطية (${triggerType}) بنجاح — ${manifest.uploadsCount} ملف مرفق.`,
  });

  // Enforce retention policy for scheduled/manual backups
  pruneOldBackups(paths.backupsDir, getSettings(db).backupRetentionCount);

  return {
    id: backupId,
    filename: backupId,
    createdAt,
    sizeBytes: manifest.totalSizeBytes,
    filesCount: manifest.uploadsCount,
    sha256: dbSha256,
    triggerType,
    verified: true,
  };
}

function pruneOldBackups(backupsDir: string, retentionCount: number): void {
  const safeLimit = Math.max(1, Number.isFinite(retentionCount) ? Math.floor(retentionCount) : loadAppConfig().backupRetentionCount);
  const entries = listBackups().filter((b) => b.triggerType !== 'pre_restore');
  if (entries.length <= safeLimit) return;

  // Never delete the latest valid backup under any circumstances
  const latestValidId = entries.find((b) => b.verified)?.id;
  const toDelete = entries.slice(safeLimit);
  for (const old of toDelete) {
    if (old.id === latestValidId) continue;
    try {
      const dir = resolveSafePath(backupsDir, old.id);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      appendOperationalLog('backup.log', `Retention cleanup skipped for ${old.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function verifyBackupIntegrity(backupId: string): { valid: boolean; reason?: string; manifest?: BackupManifest } {
  const paths = getAppPaths();
  let backupDir: string;
  try {
    backupDir = resolveSafePath(paths.backupsDir, backupId);
  } catch {
    return { valid: false, reason: 'معرّف النسخة الاحتياطية غير صالح.' };
  }

  const manifestPath = path.join(backupDir, 'manifest.json');
  const dbPath = path.join(backupDir, 'pvt_division.db');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(dbPath)) {
    return { valid: false, reason: 'ملفات النسخة الاحتياطية أو ملف التحقق مفقودة.' };
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
  } catch {
    return { valid: false, reason: 'ملف التحقق (manifest.json) تالف.' };
  }

  if (sha256File(dbPath) !== manifest.dbSha256) {
    return { valid: false, reason: 'فشل التحقق من بصمة SHA-256 لقاعدة البيانات.' };
  }

  const backupUploadsDir = path.join(backupDir, 'uploads');
  for (const [fileName, expectedHash] of Object.entries(manifest.uploadHashes || {})) {
    const fPath = path.join(backupUploadsDir, fileName);
    if (!fs.existsSync(fPath) || sha256File(fPath) !== expectedHash) {
      return { valid: false, reason: `فشل التحقق من سلامة الملف المرفق: ${fileName}` };
    }
  }

  return { valid: true, manifest };
}

export function listBackups(): BackupEntry[] {
  const paths = getAppPaths();
  if (!fs.existsSync(paths.backupsDir)) return [];

  const entries: BackupEntry[] = [];
  for (const name of fs.readdirSync(paths.backupsDir)) {
    const dir = path.join(paths.backupsDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
      const dbPath = path.join(dir, 'pvt_division.db');
      const verified = fs.existsSync(dbPath) && sha256File(dbPath) === manifest.dbSha256;
      entries.push({
        id: manifest.id,
        filename: manifest.id,
        createdAt: manifest.createdAt,
        sizeBytes: manifest.totalSizeBytes,
        filesCount: manifest.uploadsCount,
        sha256: manifest.dbSha256,
        triggerType: manifest.triggerType,
        verified,
      });
    } catch {
      // skip corrupted folder
    }
  }

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreFromBackup(
  backupId: string,
  actorUsername: string
): Promise<{ safetyBackupId: string; restoredBackupId: string }> {
  const check = verifyBackupIntegrity(backupId);
  if (!check.valid) {
    throw new Error(check.reason || 'النسخة الاحتياطية غير صالحة للاستعادة.');
  }

  // Always create automatic safety backup before restoring
  const safetyBackup = await createBackup('pre_restore', actorUsername);

  const paths = getAppPaths();
  const backupDir = resolveSafePath(paths.backupsDir, backupId);
  const srcDbPath = path.join(backupDir, 'pvt_division.db');
  const srcUploadsDir = path.join(backupDir, 'uploads');

  // Close active SQLite connection & remove WAL/SHM sidecars cleanly before replacing DB file
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${paths.dbFile}${suffix}`;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
  fs.copyFileSync(srcDbPath, paths.dbFile);

  // Restore uploaded files
  fs.rmSync(paths.uploadsDir, { recursive: true, force: true });
  fs.mkdirSync(paths.uploadsDir, { recursive: true });
  if (fs.existsSync(srcUploadsDir)) {
    for (const file of fs.readdirSync(srcUploadsDir)) {
      const src = path.join(srcUploadsDir, file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(paths.uploadsDir, file));
      }
    }
  }

  const db = reopenDb();
  writeAuditLog(db, {
    username: actorUsername,
    userRole: 'manager',
    action: 'BACKUP_RESTORE',
    module: 'backups',
    recordRef: backupId,
    description: `تمت استعادة النظام من النسخة ${backupId} بعد حفظ نسخة أمان تلقائية (${safetyBackup.id}).`,
  });

  return { safetyBackupId: safetyBackup.id, restoredBackupId: backupId };
}

let scheduledTimer: NodeJS.Timeout | null = null;
let backupInProgress = false;

export function startBackupScheduler(): void {
  if (scheduledTimer) return;
  const cfg = loadAppConfig();
  const intervalHours = cfg.autoBackupIntervalHours;
  scheduledTimer = setInterval(async () => {
    if (backupInProgress) {
      appendOperationalLog('backup.log', 'Skipped scheduled backup: previous backup job is still running.');
      return;
    }
    backupInProgress = true;
    try {
      const db = getDb();
      const settings = getSettings(db);
      if (!settings.autoBackupEnabled) return;
      const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
      if (userCount === 0) return;
      const created = await createBackup('scheduled', 'system_scheduler');
      appendOperationalLog('backup.log', `Scheduled backup succeeded: ${created.id} (${created.sizeBytes} bytes)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Backup Scheduler] Scheduled backup failed:', msg);
      appendOperationalLog('backup.log', `Scheduled backup FAILED: ${msg}`);
      try {
        writeAuditLog(getDb(), {
          username: 'system_scheduler',
          userRole: 'manager',
          action: 'BACKUP_FAILED',
          module: 'backups',
          recordRef: 'scheduled',
          description: `فشل النسخ الاحتياطي المجدول: ${msg}`,
        });
      } catch {
        // ignore secondary log error
      }
    } finally {
      backupInProgress = false;
    }
  }, intervalHours * 60 * 60 * 1000);
  scheduledTimer.unref();
}
