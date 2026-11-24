import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export interface AppConfig {
  host: string;
  port: number;
  nodeEnv: string;
  instanceDir: string;
  backupRetentionCount: number;
  autoBackupIntervalHours: number;
  hasEnvSessionSecret: boolean;
  hasEnvAdminInitialPassword: boolean;
}

export interface AppPaths {
  instanceDir: string;
  dataDir: string;
  uploadsDir: string;
  backupsDir: string;
  logsDir: string;
  dbFile: string;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = (env.HOST || '0.0.0.0').trim() || '0.0.0.0';
  const rawPort = Number(env.PORT || 3000);
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 3000;
  const nodeEnv = (env.NODE_ENV || 'development').trim();

  const rawInstance = (env.INSTANCE_DIR || '').trim();
  const instanceDir = rawInstance ? path.resolve(rawInstance) : path.resolve(process.cwd(), 'instance');

  const rawRetention = Number(env.BACKUP_RETENTION_COUNT ?? 30);
  const backupRetentionCount =
    Number.isFinite(rawRetention) && rawRetention >= 1 ? Math.floor(rawRetention) : 30;

  // Preserve the exact existing environment variable name: AUTO_BACKUP_INTERVAL_HOURS (measured in hours)
  const rawInterval = Number(env.AUTO_BACKUP_INTERVAL_HOURS ?? 24);
  const autoBackupIntervalHours =
    Number.isFinite(rawInterval) && rawInterval >= 1 ? Math.floor(rawInterval) : 24;

  const envSecret = (env.SESSION_SECRET || '').trim();
  const envAdminPwd = (env.ADMIN_INITIAL_PASSWORD || '').trim();

  return {
    host,
    port,
    nodeEnv,
    instanceDir,
    backupRetentionCount,
    autoBackupIntervalHours,
    hasEnvSessionSecret: envSecret.length >= 32,
    hasEnvAdminInitialPassword: envAdminPwd.length > 0,
  };
}

export function ensureAppPaths(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const cfg = loadAppConfig(env);
  const dataDir = path.join(cfg.instanceDir, 'data');
  const uploadsDir = path.join(cfg.instanceDir, 'uploads');
  const backupsDir = path.join(cfg.instanceDir, 'backups');
  const logsDir = path.join(cfg.instanceDir, 'logs');
  const dbFile = path.join(dataDir, 'pvt_division.db');

  for (const dir of [cfg.instanceDir, dataDir, uploadsDir, backupsDir, logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    instanceDir: cfg.instanceDir,
    dataDir,
    uploadsDir,
    backupsDir,
    logsDir,
    dbFile,
  };
}

/**
 * Resolves a stable, cryptographically strong session secret:
 * 1. Uses process.env.SESSION_SECRET if provided (>= 32 chars).
 * 2. Otherwise generates a 32-byte random secret once during initial setup and persists it
 *    in the central SQLite database so sessions remain valid across restarts without
 *    hard-coding or logging any secret value.
 */
export function resolvePersistentSessionSecret(db: Database.Database, env: NodeJS.ProcessEnv = process.env): string {
  const envSecret = (env.SESSION_SECRET || '').trim();
  if (envSecret.length >= 32) {
    return envSecret;
  }

  const row = db
    .prepare(`SELECT value_json FROM system_settings WHERE key = 'internal_session_secret'`)
    .get() as { value_json: string } | undefined;

  if (row?.value_json) {
    try {
      const parsed = JSON.parse(row.value_json) as { secret?: string };
      if (parsed.secret && parsed.secret.length >= 32) {
        return parsed.secret;
      }
    } catch {
      // regenerate below
    }
  }

  const generated = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO system_settings (key, value_json, updated_at) VALUES ('internal_session_secret', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
  ).run(JSON.stringify({ secret: generated }));

  return generated;
}

export function appendOperationalLog(logFileName: string, message: string): void {
  try {
    const { logsDir } = ensureAppPaths();
    const target = path.join(logsDir, logFileName);
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(target, line, 'utf8');
  } catch {
    // never crash request flow due to file logging failure
  }
}
