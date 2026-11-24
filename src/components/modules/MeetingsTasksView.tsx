import React, { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, Plus } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { AuthUser, MeetingRecord, TaskRecord } from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { StatusBadge } from '../StatusBadge';

export function MeetingsTasksView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<'tasks' | 'meetings' | 'calendar'>('tasks');
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskModal, setTaskModal] = useState(false);
  const [mtgModal, setMtgModal] = useState(false);

  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    assignedTo: user.fullNameAr,
    priority: 'medium',
    startDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
  });
  const [mtgForm, setMtgForm] = useState({
    title: '',
    meetingDate: new Date().toISOString().slice(0, 10),
    location: 'قاعة اجتماعات الشعبة',
    agenda: '',
    attendees: '',
    minutes: '',
    decisions: '',
  });

  const canWrite = user.role === 'manager' || user.role === 'engineer';
  const today = new Date().toISOString().slice(0, 10);

  const load = () => {
    setLoading(true);
    apiRequest<{ meetings: MeetingRecord[]; tasks: TaskRecord[] }>('/meetings-tasks')
      .then((res) => {
        setMeetings(res.meetings);
        setTasks(res.tasks);
      })
      .catch((err) => onToast(err.message, 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/tasks', { method: 'POST', body: taskForm });
      onToast('تم إنشاء المهمة الداخلية بنجاح.');
      setTaskModal(false);
      setTaskForm((f) => ({ ...f, title: '', description: '' }));
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل إضافة المهمة.', 'err');
    }
  };

  const completeTask = async (task: TaskRecord) => {
    try {
      await apiRequest(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: 'completed', completionNotes: 'تم الإنجاز بنجاح' },
      });
      onToast('تم تأشير المهمة كمكتملة.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحديث المهمة.', 'err');
    }
  };

  const submitMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/meetings', { method: 'POST', body: mtgForm });
      onToast('تم توثيق محضر الاجتماع بنجاح.');
      setMtgModal(false);
      setMtgForm((f) => ({ ...f, title: '', agenda: '', minutes: '', decisions: '' }));
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل حفظ الاجتماع.', 'err');
    }
  };

  // Build simple current-month calendar days
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">الاجتماعات والمهام الداخلية والتقويم</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            توثيق محاضر وقرارات اجتماعات الشعبة ومتابعة المهام الموكلة للموظفين عبر الجدول والتقويم الشهري.
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTaskModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مهمة داخلية</span>
            </button>
            <button
              type="button"
              onClick={() => setMtgModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#17445C] text-[#17445C] dark:text-teal-300 dark:border-teal-500/60 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>توثيق اجتماع</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg w-fit">
        {[
          { key: 'tasks', label: `المهام الداخلية (${tasks.length})` },
          { key: 'meetings', label: `الاجتماعات والمحاضر (${meetings.length})` },
          { key: 'calendar', label: 'التقويم الشهري' },
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

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : tab === 'tasks' ? (
        <DataTable
          rows={tasks}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث بعنوان المهمة أو الموظف المكلف..."
          searchFilter={(r, q) => `${r.title} ${r.assignedTo} ${r.description}`.toLowerCase().includes(q)}
          columns={[
            {
              key: 'title',
              header: 'المهمة',
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs">{r.title}</p>
                  <p className="text-[11px] text-[#718096] max-w-md truncate">{r.description}</p>
                </div>
              ),
            },
            { key: 'assigned', header: 'المكلف بالتنفيذ', render: (r) => <span className="text-xs font-medium">{r.assignedTo}</span> },
            { key: 'prio', header: 'الأولوية', render: (r) => <StatusBadge status={r.priority} /> },
            {
              key: 'due',
              header: 'تاريخ الاستحقاق',
              render: (r) => {
                const isOverdue = r.status !== 'completed' && r.dueDate < today;
                return (
                  <span className={`font-mono text-xs tabular-nums ${isOverdue ? 'text-red-700 dark:text-red-400 font-bold' : ''}`}>
                    {r.dueDate}
                  </span>
                );
              },
            },
            { key: 'status', header: 'الحالة', render: (r) => <StatusBadge status={r.status !== 'completed' && r.dueDate < today ? 'overdue' : r.status} /> },
            {
              key: 'act',
              header: 'إجراء',
              render: (r) =>
                canWrite && r.status !== 'completed' ? (
                  <button
                    type="button"
                    onClick={() => completeTask(r)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-700 hover:bg-emerald-800 text-white"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>إنجاز</span>
                  </button>
                ) : (
                  <span className="text-xs text-[#718096]">مكتملة</span>
                ),
            },
          ]}
        />
      ) : tab === 'meetings' ? (
        <div className="space-y-4">
          {meetings.map((m) => (
            <div key={m.id} className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#DFE6EC] dark:border-[#2C3D4D]">
                <div>
                  <span className="font-mono text-xs text-[#078C8C] ml-2" dir="ltr">{m.meetingNumber}</span>
                  <h3 className="inline text-base font-bold text-[#102638] dark:text-[#E8EEF3]">{m.title}</h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-[#718096]">{m.meetingDate} · {m.location}</span>
                  <StatusBadge status={m.status} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="font-semibold text-[#66869A] mb-1">الحضور</p>
                  <p className="leading-relaxed">{m.attendees || '—'}</p>
                </div>
                <div>
                  <p className="font-semibold text-[#66869A] mb-1">جدول الأعمال والمحضر</p>
                  <p className="whitespace-pre-line leading-relaxed">{m.minutes || m.agenda || '—'}</p>
                </div>
                <div>
                  <p className="font-semibold text-[#66869A] mb-1">القرارات والتوصيات</p>
                  <p className="whitespace-pre-line leading-relaxed">{m.decisions || '—'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="w-5 h-5 text-[#078C8C]" />
            <h3 className="text-base font-bold">تقويم المهام والاجتماعات — {monthPrefix}</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {Array.from({ length: daysInMonth }, (_, i) => {
              const dayStr = `${monthPrefix}-${String(i + 1).padStart(2, '0')}`;
              const dayTasks = tasks.filter((t) => t.dueDate === dayStr);
              const dayMtgs = meetings.filter((m) => m.meetingDate === dayStr);
              const isToday = dayStr === today;
              return (
                <div
                  key={dayStr}
                  className={`min-h-[84px] p-2 rounded border text-xs ${
                    isToday
                      ? 'border-[#078C8C] bg-[#DDF2F0]/40 dark:bg-[#078C8C]/15'
                      : 'border-[#DFE6EC] dark:border-[#2C3D4D] bg-[#F3F6F9]/50 dark:bg-[#101A24]/40'
                  }`}
                >
                  <p className={`font-mono font-bold tabular-nums mb-1 ${isToday ? 'text-[#078C8C]' : 'text-[#66869A]'}`}>
                    {i + 1}
                  </p>
                  {dayMtgs.map((m) => (
                    <p key={m.id} className="truncate text-[11px] font-semibold text-[#17445C] dark:text-amber-300">
                      • {m.title}
                    </p>
                  ))}
                  {dayTasks.map((t) => (
                    <p key={t.id} className="truncate text-[11px] text-[#078C8C] dark:text-teal-300">
                      ▪ {t.title}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      <Modal open={taskModal} onClose={() => setTaskModal(false)} title="إنشاء مهمة داخلية جديدة" size="md">
        <form onSubmit={submitTask} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">عنوان المهمة *</label>
            <input type="text" required value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">المكلف بالتنفيذ *</label>
              <input type="text" required value={taskForm.assignedTo} onChange={(e) => setTaskForm({ ...taskForm, assignedTo: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الأولوية</label>
              <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="urgent">عاجلة</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ البدء</label>
              <input type="date" value={taskForm.startDate} onChange={(e) => setTaskForm({ ...taskForm, startDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ الاستحقاق *</label>
              <input type="date" required value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">التفاصيل</label>
            <textarea rows={2} value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTaskModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ المهمة</button>
          </div>
        </form>
      </Modal>

      <Modal open={mtgModal} onClose={() => setMtgModal(false)} title="توثيق اجتماع ومحضر الشعبة" size="lg">
        <form onSubmit={submitMeeting} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">عنوان الاجتماع *</label>
              <input type="text" required value={mtgForm.title} onChange={(e) => setMtgForm({ ...mtgForm, title: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التاريخ *</label>
              <input type="date" required value={mtgForm.meetingDate} onChange={(e) => setMtgForm({ ...mtgForm, meetingDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">المكان</label>
              <input type="text" value={mtgForm.location} onChange={(e) => setMtgForm({ ...mtgForm, location: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الحضور</label>
              <input type="text" value={mtgForm.attendees} onChange={(e) => setMtgForm({ ...mtgForm, attendees: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">المحضر وجدول الأعمال</label>
            <textarea rows={2} value={mtgForm.minutes} onChange={(e) => setMtgForm({ ...mtgForm, minutes: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">القرارات والتكليفات</label>
            <textarea rows={2} value={mtgForm.decisions} onChange={(e) => setMtgForm({ ...mtgForm, decisions: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMtgModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ المحضر</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
