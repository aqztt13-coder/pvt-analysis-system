import React, { useEffect, useState } from 'react';
import { CalendarPlus, Check, Plus, X } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type {
  AttendanceRecord,
  AuthUser,
  Employee,
  LeaveRequest,
  LeaveTypeConfig,
  OfficialHoliday,
} from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { StatusBadge } from '../StatusBadge';

export function AttendanceLeaveView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<'leaves' | 'attendance' | 'holidays'>('leaves');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeConfig[]>([]);
  const [holidays, setHolidays] = useState<OfficialHoliday[]>([]);
  const [loading, setLoading] = useState(true);

  const [leaveModal, setLeaveModal] = useState(false);
  const [attModal, setAttModal] = useState(false);
  const [holidayModal, setHolidayModal] = useState(false);

  const [leaveForm, setLeaveForm] = useState({
    employeeId: '',
    leaveTypeCode: 'annual',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    daysCount: 1,
    reason: '',
  });
  const [attForm, setAttForm] = useState({
    employeeId: '',
    workDate: new Date().toISOString().slice(0, 10),
    status: 'present',
    checkIn: '08:00',
    checkOut: '15:00',
    notes: '',
  });
  const [holForm, setHolForm] = useState({
    title: '',
    holidayDate: '',
    endDate: '',
    notes: '',
  });

  const isManager = user.role === 'manager';
  const canCreateLeave = user.role === 'manager' || user.role === 'engineer';

  const load = async () => {
    setLoading(true);
    try {
      const [attData, empData] = await Promise.all([
        apiRequest<{
          attendance: AttendanceRecord[];
          holidays: OfficialHoliday[];
          leaveTypes: LeaveTypeConfig[];
          leaves: LeaveRequest[];
        }>('/attendance'),
        apiRequest<{ items: Employee[] }>('/employees'),
      ]);
      setAttendance(attData.attendance);
      setHolidays(attData.holidays);
      setLeaveTypes(attData.leaveTypes);
      setLeaves(attData.leaves);
      setEmployees(empData.items);
      if (empData.items.length > 0) {
        setLeaveForm((f) => ({ ...f, employeeId: f.employeeId || String(empData.items[0].id) }));
        setAttForm((f) => ({ ...f, employeeId: f.employeeId || String(empData.items[0].id) }));
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحميل بيانات الدوام.', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/leaves', {
        method: 'POST',
        body: { ...leaveForm, employeeId: Number(leaveForm.employeeId) },
      });
      onToast('تم تقديم طلب الإجازة بنجاح وبانتظار الاعتماد.');
      setLeaveModal(false);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل تقديم الإجازة.', 'err');
    }
  };

  const decideLeave = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await apiRequest(`/leaves/${id}/decision`, {
        method: 'POST',
        body: {
          status,
          decisionNotes: status === 'approved' ? 'موافق عليه من إدارة الشعبة' : 'مرفوض لمتطلبات العمل الحالية',
        },
      });
      onToast(status === 'approved' ? 'تم اعتماد طلب الإجازة.' : 'تم رفض طلب الإجازة.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تنفيذ القرار.', 'err');
    }
  };

  const submitAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/attendance', {
        method: 'POST',
        body: { ...attForm, employeeId: Number(attForm.employeeId) },
      });
      onToast('تم تسجيل قيد الدوام بنجاح.');
      setAttModal(false);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تسجيل الدوام.', 'err');
    }
  };

  const submitHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/holidays', { method: 'POST', body: holForm });
      onToast('تمت إضافة العطلة الرسمية.');
      setHolidayModal(false);
      setHolForm({ title: '', holidayDate: '', endDate: '', notes: '' });
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر حفظ العطلة.', 'err');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">الحضور والإجازات والعطل الرسمية</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            توثيق الدوام اليدوي بدون أجهزة بصمة، وتقديم واعتماد الإجازات وفق الضوابط الإدارية القابلة للتهيئة.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateLeave && (
            <button
              type="button"
              onClick={() => setLeaveModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>تقديم طلب إجازة</span>
            </button>
          )}
          {isManager && (
            <>
              <button
                type="button"
                onClick={() => setAttModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] whitespace-nowrap"
              >
                <CalendarPlus className="w-4 h-4 text-[#078C8C]" />
                <span>تسجيل حضور/غياب</span>
              </button>
              <button
                type="button"
                onClick={() => setHolidayModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] whitespace-nowrap"
              >
                <span>إضافة عطلة رسمية</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg w-fit">
        {[
          { key: 'leaves', label: `طلبات الإجازات (${leaves.length})` },
          { key: 'attendance', label: `سجل الحضور (${attendance.length})` },
          { key: 'holidays', label: `العطل والأنواع (${holidays.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'bg-[#102638] dark:bg-[#078C8C] text-white'
                : 'text-[#718096] dark:text-[#A9B7C4] hover:text-[#102638] dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : tab === 'leaves' ? (
        <DataTable
          rows={leaves}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث باسم الموظف أو نوع الإجازة..."
          searchFilter={(r, q) => `${r.employeeName} ${r.leaveTypeName} ${r.reason}`.toLowerCase().includes(q)}
          columns={[
            {
              key: 'emp',
              header: 'الموظف',
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs">{r.employeeName}</p>
                  <p className="text-[11px] font-mono text-[#718096]" dir="ltr">{r.employeeCode}</p>
                </div>
              ),
            },
            { key: 'type', header: 'نوع الإجازة', render: (r) => <span className="text-xs">{r.leaveTypeName}</span> },
            {
              key: 'dates',
              header: 'الفترة والأيام',
              render: (r) => (
                <div className="text-xs tabular-nums">
                  <span className="font-mono" dir="ltr">{r.startDate} → {r.endDate}</span>
                  <span className="text-[#718096] mr-2">({r.daysCount} يوم)</span>
                </div>
              ),
            },
            { key: 'reason', header: 'السبب', mobileHidden: true, render: (r) => <span className="text-xs">{r.reason || '—'}</span> },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'decision',
              header: 'الإجراء / الاعتماد',
              render: (r) =>
                r.status === 'pending' && isManager ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => decideLeave(r.id, 'approved')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-700 hover:bg-emerald-800 text-white"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>اعتماد</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => decideLeave(r.id, 'rejected')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-red-700 hover:bg-red-800 text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>رفض</span>
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-[#718096] dark:text-[#A9B7C4]">
                    {r.decidedBy ? `بواسطة: ${r.decidedBy}` : 'بانتظار مدير الشعبة'}
                  </span>
                ),
            },
          ]}
        />
      ) : tab === 'attendance' ? (
        <DataTable
          rows={attendance}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث باسم الموظف أو التاريخ..."
          searchFilter={(r, q) => `${r.employeeName} ${r.workDate} ${r.notes}`.toLowerCase().includes(q)}
          columns={[
            { key: 'date', header: 'التاريخ', render: (r) => <span className="font-mono text-xs tabular-nums">{r.workDate}</span> },
            { key: 'emp', header: 'الموظف', render: (r) => <span className="font-semibold text-xs">{r.employeeName}</span> },
            { key: 'status', header: 'حالة الدوام', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'in', header: 'الحضور', render: (r) => <span className="font-mono text-xs tabular-nums">{r.checkIn || '—'}</span> },
            { key: 'out', header: 'الانصراف', render: (r) => <span className="font-mono text-xs tabular-nums">{r.checkOut || '—'}</span> },
            { key: 'notes', header: 'ملاحظات', render: (r) => <span className="text-xs text-[#718096]">{r.notes || '—'}</span> },
          ]}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5">
            <h3 className="text-base font-bold mb-3">أنواع الإجازات والأرصدة السنوية المعتمدة</h3>
            <ul className="divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D] text-sm">
              {leaveTypes.map((lt) => (
                <li key={lt.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-[#102638] dark:text-[#E8EEF3]">{lt.nameAr}</p>
                    <p className="text-xs text-[#718096]">
                      {lt.requiresAttachment ? 'تتطلب مرفقاً أو تقريراً' : 'بدون مرفق إلزامي'}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums text-xs font-bold text-[#078C8C]">
                    {lt.annualAllowance} يوم / سنة
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5">
            <h3 className="text-base font-bold mb-3">العطل الرسمية المسجلة</h3>
            <ul className="divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D] text-sm">
              {holidays.map((h) => (
                <li key={h.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-[#102638] dark:text-[#E8EEF3]">{h.title}</p>
                    <p className="text-xs text-[#718096]">{h.notes}</p>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-[#718096]" dir="ltr">
                    {h.holidayDate}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Modals */}
      <Modal open={leaveModal} onClose={() => setLeaveModal(false)} title="تقديم طلب إجازة جديدة" size="md">
        <form onSubmit={submitLeave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">الموظف *</label>
            <select
              value={leaveForm.employeeId}
              onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              required
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullNameAr} ({e.employeeCode})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">نوع الإجازة *</label>
            <select
              value={leaveForm.leaveTypeCode}
              onChange={(e) => setLeaveForm({ ...leaveForm, leaveTypeCode: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
            >
              {leaveTypes.map((lt) => (
                <option key={lt.code} value={lt.code}>
                  {lt.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">من تاريخ</label>
              <input
                type="date"
                value={leaveForm.startDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">إلى تاريخ</label>
              <input
                type="date"
                value={leaveForm.endDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">عدد الأيام</label>
              <input
                type="number"
                min={1}
                value={leaveForm.daysCount}
                onChange={(e) => setLeaveForm({ ...leaveForm, daysCount: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">السبب / الملاحظات</label>
            <textarea
              rows={2}
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setLeaveModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">
              إلغاء
            </button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">
              إرسال الطلب
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={attModal} onClose={() => setAttModal(false)} title="تسجيل أو تعديل قيد حضور يومي" size="md">
        <form onSubmit={submitAttendance} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">الموظف</label>
            <select
              value={attForm.employeeId}
              onChange={(e) => setAttForm({ ...attForm, employeeId: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullNameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">التاريخ</label>
              <input
                type="date"
                value={attForm.workDate}
                onChange={(e) => setAttForm({ ...attForm, workDate: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">حالة الدوام</label>
              <select
                value={attForm.status}
                onChange={(e) => setAttForm({ ...attForm, status: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
              >
                <option value="present">حاضر</option>
                <option value="absent">غائب</option>
                <option value="late">متأخر</option>
                <option value="on_leave">إجازة</option>
                <option value="mission">إيفاد / واجب رسمي</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">وقت الحضور</label>
              <input type="time" value={attForm.checkIn} onChange={(e) => setAttForm({ ...attForm, checkIn: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">وقت الانصراف</label>
              <input type="time" value={attForm.checkOut} onChange={(e) => setAttForm({ ...attForm, checkOut: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">ملاحظات</label>
            <input type="text" value={attForm.notes} onChange={(e) => setAttForm({ ...attForm, notes: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAttModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ القيد</button>
          </div>
        </form>
      </Modal>

      <Modal open={holidayModal} onClose={() => setHolidayModal(false)} title="إضافة عطلة رسمية" size="md">
        <form onSubmit={submitHoliday} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">مسمى العطلة *</label>
            <input type="text" required value={holForm.title} onChange={(e) => setHolForm({ ...holForm, title: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ البدء *</label>
              <input type="date" required value={holForm.holidayDate} onChange={(e) => setHolForm({ ...holForm, holidayDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ الانتهاء</label>
              <input type="date" value={holForm.endDate} onChange={(e) => setHolForm({ ...holForm, endDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setHolidayModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
