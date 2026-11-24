import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  DatabaseBackup,
  HardDrive,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import {
  type AuditLogEntry,
  type AuthUser,
  type BackupEntry,
  ROLE_LABELS,
  type SystemSettings,
  type UserRole,
} from '../../shared/types';
import { DataTable } from '../DataTable';
import { ConfirmDialog, Modal } from '../Modal';
import { StatusBadge } from '../StatusBadge';

export function AdminSystemView({
  currentUser,
  settings,
  onSettingsUpdated,
  onToast,
}: {
  currentUser: AuthUser;
  settings: SystemSettings;
  onSettingsUpdated: (s: SystemSettings) => void;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<'users' | 'backups' | 'settings' | 'audit'>('users');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [settingsForm, setSettingsForm] = useState<SystemSettings>(settings);
  const [userModal, setUserModal] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    fullNameAr: '',
    fullNameEn: '',
    role: 'engineer' as UserRole,
    jobTitle: '',
    email: '',
  });

  const loadAll = async () => {
    try {
      const [uRes, bRes, aRes] = await Promise.all([
        apiRequest<{ items: AuthUser[] }>('/admin/users'),
        apiRequest<{ items: BackupEntry[] }>('/admin/backups'),
        apiRequest<{ items: AuditLogEntry[] }>('/admin/audit-logs'),
      ]);
      setUsers(uRes.items);
      setBackups(bRes.items);
      setAuditLogs(aRes.items);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحميل بيانات الإدارة.', 'err');
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/admin/users', { method: 'POST', body: newUser });
      onToast(`تم إنشاء حساب المستخدم ${newUser.username} بنجاح.`);
      setUserModal(false);
      setNewUser({ username: '', password: '', fullNameAr: '', fullNameEn: '', role: 'engineer', jobTitle: '', email: '' });
      loadAll();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل إنشاء المستخدم.', 'err');
    } finally {
      setBusy(false);
    }
  };

  const toggleUserActive = async (u: AuthUser) => {
    try {
      await apiRequest(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: { isActive: !u.isActive },
      });
      onToast(u.isActive ? `تم إيقاف الحساب ${u.username}.` : `تم تفعيل الحساب ${u.username}.`);
      loadAll();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تعديل حالة الحساب.', 'err');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await apiRequest<SystemSettings>('/admin/settings', {
        method: 'PUT',
        body: settingsForm,
      });
      onSettingsUpdated(updated);
      onToast('تم حفظ إعدادات النظام والهوية المؤسسية.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.', 'err');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBackup = async () => {
    setBusy(true);
    try {
      const entry = await apiRequest<BackupEntry>('/admin/backups', { method: 'POST' });
      onToast(`تم إنشاء النسخة الاحتياطية ${entry.id} والتحقق من سلامتها (SHA-256).`);
      loadAll();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل إنشاء النسخة الاحتياطية.', 'err');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyBackup = async (b: BackupEntry) => {
    try {
      const res = await apiRequest<{ valid: boolean; reason: string | null }>(
        `/admin/backups/${encodeURIComponent(b.id)}/verify`
      );
      if (res.valid) {
        onToast(`النسخة ${b.id} سليمة ومطابقة تماماً لبصمة SHA-256.`);
      } else {
        onToast(res.reason || 'فشل التحقق من سلامة النسخة.', 'err');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر فحص النسخة.', 'err');
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ safetyBackupId: string; restoredBackupId: string }>(
        `/admin/backups/${encodeURIComponent(restoreTarget.id)}/restore`,
        { method: 'POST' }
      );
      onToast(`تمت الاستعادة من ${res.restoredBackupId} بعد إنشاء نسخة أمان تلقائية (${res.safetyBackupId}).`);
      setRestoreTarget(null);
      loadAll();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشلت عملية الاستعادة.', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">إدارة النظام والأمان والنسخ الاحتياطي</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            لوحة تحكم مدير الشعبة لإدارة المستخدمين والصلاحيات، إعدادات الهوية والتقارير، النسخ الاحتياطي الحي، وسجل التدقيق غير القابل للتعديل.
          </p>
        </div>
        {tab === 'users' && (
          <button
            type="button"
            onClick={() => setUserModal(true)}
            className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            <span>إنشاء حساب مستخدم</span>
          </button>
        )}
        {tab === 'backups' && (
          <button
            type="button"
            disabled={busy}
            onClick={handleCreateBackup}
            className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#078C8C] hover:bg-[#067575] text-white whitespace-nowrap disabled:opacity-60"
          >
            <DatabaseBackup className="w-4 h-4" />
            <span>{busy ? 'جارٍ النسخ الاحتياطي...' : 'إنشاء نسخة احتياطية فورية'}</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg w-fit">
        {[
          { key: 'users', label: `المستخدمون والصلاحيات (${users.length})` },
          { key: 'backups', label: `النسخ الاحتياطي والاستعادة (${backups.length})` },
          { key: 'settings', label: 'إعدادات النظام والهوية' },
          { key: 'audit', label: `سجل التدقيق (${auditLogs.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
              tab === t.key ? 'bg-[#102638] dark:bg-[#078C8C] text-white' : 'text-[#718096]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <DataTable
          rows={users}
          rowKey={(u) => u.id}
          searchPlaceholder="بحث باسم المستخدم أو الاسم الكامل..."
          searchFilter={(u, q) => `${u.username} ${u.fullNameAr} ${u.role}`.toLowerCase().includes(q)}
          columns={[
            { key: 'user', header: 'اسم المستخدم', render: (u) => <span className="font-mono text-xs font-semibold text-[#078C8C]" dir="ltr">{u.username}</span> },
            { key: 'name', header: 'الاسم والصفة الوظيفية', render: (u) => <div><p className="font-semibold text-xs">{u.fullNameAr}</p><p className="text-[11px] text-[#718096]">{u.jobTitle || '—'}</p></div> },
            { key: 'role', header: 'الدور والصلاحية', render: (u) => <span className="text-xs font-semibold">{ROLE_LABELS[u.role].ar}</span> },
            { key: 'login', header: 'آخر دخول', render: (u) => <span className="font-mono text-xs text-[#718096]" dir="ltr">{u.lastLoginAt ? u.lastLoginAt.slice(0, 16) : 'لم يدخل بعد'}</span> },
            { key: 'state', header: 'الحالة', render: (u) => <StatusBadge status={u.isActive ? 'active' : 'suspended'} customLabel={u.isActive ? 'نشط' : 'موقوف'} /> },
            {
              key: 'act',
              header: 'إجراء',
              render: (u) =>
                u.id !== currentUser.id ? (
                  <button
                    type="button"
                    onClick={() => toggleUserActive(u)}
                    className="px-3 py-1.5 text-xs font-semibold rounded border border-[#DFE6EC] dark:border-[#2C3D4D] hover:bg-[#F3F6F9] dark:hover:bg-[#203C50]"
                  >
                    {u.isActive ? 'إيقاف الحساب' : 'إعادة تفعيل'}
                  </button>
                ) : (
                  <span className="text-xs text-[#718096]">الحساب الحالي</span>
                ),
            },
          ]}
        />
      )}

      {tab === 'backups' && (
        <div className="space-y-5">
          <div className="p-4 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] flex items-start gap-3 text-xs">
            <HardDrive className="w-5 h-5 text-[#078C8C] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-[#102638] dark:text-[#E8EEF3]">
                آلية النسخ الاحتياطي الحي (SQLite Online Backup API + أرشيف المرفقات + بصمة SHA-256)
              </p>
              <p className="text-[#718096] dark:text-[#A9B7C4] leading-relaxed">
                يتم حفظ النسخ الاحتياطية في مجلد <span className="font-mono">instance/backups/</span> المفصول عن الشيفرة المصدرية، وتشمل قاعدة البيانات وجميع الملفات المرفقة. قبل أي عملية استعادة، ينشئ النظام تلقائياً نسخة أمان احترازية (<span className="font-mono">pre_restore</span>).
              </p>
            </div>
          </div>

          <DataTable
            rows={backups}
            rowKey={(b) => b.id}
            emptyTitle="لم يتم إنشاء نسخ احتياطية بعد"
            emptyDescription="اضغط على زر «إنشاء نسخة احتياطية فورية» لحفظ أول نسخة موثقة من قاعدة البيانات والمرفقات."
            columns={[
              { key: 'id', header: 'معرّف النسخة', render: (b) => <span className="font-mono text-xs font-semibold text-[#102638] dark:text-[#E8EEF3]" dir="ltr">{b.id}</span> },
              { key: 'date', header: 'التاريخ والوقت', render: (b) => <span className="font-mono text-xs tabular-nums" dir="ltr">{b.createdAt.slice(0, 19).replace('T', ' ')}</span> },
              { key: 'type', header: 'المصدر', render: (b) => <span className="text-xs">{b.triggerType === 'manual' ? 'يدوي' : b.triggerType === 'scheduled' ? 'تلقائي مجدول' : 'أمان قبل الاستعادة'}</span> },
              { key: 'size', header: 'الحجم والمرفقات', render: (b) => <span className="font-mono text-xs tabular-nums">{(b.sizeBytes / 1024).toFixed(1)} KB · {b.filesCount} ملف</span> },
              {
                key: 'ver',
                header: 'سلامة البصمة',
                render: (b) => (
                  <StatusBadge status={b.verified ? 'active' : 'critical'} customLabel={b.verified ? 'سليمة (SHA-256)' : 'غير متطابقة'} />
                ),
              },
              {
                key: 'act',
                header: 'الإجراءات',
                render: (b) => (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleVerifyBackup(b)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border border-[#DFE6EC] dark:border-[#2C3D4D] hover:bg-[#F3F6F9] dark:hover:bg-[#203C50]"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#078C8C]" />
                      <span>فحص</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRestoreTarget(b)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-amber-700 hover:bg-amber-800 text-white"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>استعادة</span>
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {tab === 'settings' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-6 space-y-5"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">اسم الشركة / الهيئة (عربي)</label>
              <input
                type="text"
                value={settingsForm.companyNameAr}
                onChange={(e) => setSettingsForm({ ...settingsForm, companyNameAr: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم الشركة (إنجليزي)</label>
              <input
                type="text"
                dir="ltr"
                value={settingsForm.companyNameEn}
                onChange={(e) => setSettingsForm({ ...settingsForm, companyNameEn: e.target.value })}
                className="w-full px-3 py-2 text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم الشعبة (عربي)</label>
              <input
                type="text"
                value={settingsForm.divisionNameAr}
                onChange={(e) => setSettingsForm({ ...settingsForm, divisionNameAr: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم الشعبة (إنجليزي)</label>
              <input
                type="text"
                dir="ltr"
                value={settingsForm.divisionNameEn}
                onChange={(e) => setSettingsForm({ ...settingsForm, divisionNameEn: e.target.value })}
                className="w-full px-3 py-2 text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold mb-1">تذييل التقارير الرسمية المطبوعة</label>
              <input
                type="text"
                value={settingsForm.reportFooterAr}
                onChange={(e) => setSettingsForm({ ...settingsForm, reportFooterAr: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">أيام التنبيه المبكر للمعايرة</label>
              <input
                type="number"
                min={5}
                max={180}
                value={settingsForm.calibrationAlertDays}
                onChange={(e) => setSettingsForm({ ...settingsForm, calibrationAlertDays: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">عدد النسخ الاحتياطية المحتفظ بها</label>
              <input
                type="number"
                min={3}
                max={60}
                value={settingsForm.backupRetentionCount}
                onChange={(e) => setSettingsForm({ ...settingsForm, backupRetentionCount: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
          </div>

          <div className="p-4 rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] flex items-start gap-2.5 text-xs">
            <ShieldAlert className="w-4 h-4 text-[#C99A45] shrink-0 mt-0.5" />
            <p className="text-[#718096] dark:text-[#A9B7C4]">
              تشغيل الشبكة المحلية (LAN): احرص على تثبيت عنوان IP محلي للخادم المركزي وتفعيل قواعد جدار الحماية لحصر الوصول على أجهزة شعبة موائع المكامن فقط.
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-2.5 text-sm font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white disabled:opacity-60"
            >
              {busy ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </div>
        </form>
      )}

      {tab === 'audit' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-[#718096] dark:text-[#A9B7C4]">
            <ShieldCheck className="w-4 h-4 text-[#078C8C]" />
            <span>سجل التدقيق للقراءة فقط ومحصّن ضد التعديل أو الحذف لضمان النزاهة الإدارية.</span>
          </div>
          <DataTable
            rows={auditLogs}
            rowKey={(a) => a.id}
            searchPlaceholder="بحث بالمستخدم أو الإجراء أو الوحدة أو الوصف..."
            searchFilter={(a, q) => `${a.username} ${a.action} ${a.module} ${a.description} ${a.recordRef}`.toLowerCase().includes(q)}
            columns={[
              { key: 'time', header: 'التاريخ والوقت', render: (a) => <span className="font-mono text-xs tabular-nums" dir="ltr">{a.createdAt.slice(0, 19)}</span> },
              { key: 'user', header: 'المستخدم', render: (a) => <span className="font-mono text-xs font-semibold" dir="ltr">{a.username}</span> },
              { key: 'action', header: 'الإجراء', render: (a) => <span className="font-mono text-xs text-[#078C8C]" dir="ltr">{a.action}</span> },
              { key: 'mod', header: 'الوحدة', render: (a) => <span className="text-xs">{a.module}</span> },
              { key: 'desc', header: 'التفاصيل', render: (a) => <span className="text-xs">{a.description}</span> },
            ]}
          />
        </div>
      )}

      {/* Create User Modal */}
      <Modal open={userModal} onClose={() => setUserModal(false)} title="إنشاء حساب مستخدم جديد" size="md">
        <form onSubmit={createUser} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">اسم المستخدم (إنجليزي) *</label>
              <input type="text" dir="ltr" required value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="eng.ali" className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الدور الوظيفي *</label>
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="engineer">مهندس (Engineer)</option>
                <option value="viewer">مستعرض — قراءة فقط (Viewer)</option>
                <option value="manager">مدير شعبة (Division Manager)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">الاسم الكامل (عربي) *</label>
            <input type="text" required value={newUser.fullNameAr} onChange={(e) => setNewUser({ ...newUser, fullNameAr: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">الصفة الوظيفية</label>
            <input type="text" value={newUser.jobTitle} onChange={(e) => setNewUser({ ...newUser, jobTitle: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">كلمة المرور الأولية (8 أحرف + أرقام) *</label>
            <input type="password" dir="ltr" required value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setUserModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white disabled:opacity-60">
              <Plus className="w-4 h-4" />
              <span>إنشاء الحساب</span>
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
        title="تأكيد استعادة النسخة الاحتياطية"
        message={`هل أنت متأكد من استعادة النظام من النسخة "${restoreTarget?.id}"؟ سيقوم النظام تلقائياً بحفظ نسخة أمان احترازية من البيانات الحالية قبل الاستعادة.`}
        confirmLabel="تأكيد الاستعادة الآن"
        danger
        busy={busy}
      />
    </div>
  );
}
