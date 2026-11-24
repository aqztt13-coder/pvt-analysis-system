import React, { useState } from 'react';
import { Lock, Moon, ShieldCheck, Sun, UserCheck } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api';
import type { AuthUser } from '../shared/types';

interface AuthScreenProps {
  needsSetup: boolean;
  companyNameAr: string;
  divisionNameAr: string;
  divisionNameEn: string;
  darkMode: boolean;
  onToggleDark: () => void;
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthScreen({
  needsSetup,
  companyNameAr,
  divisionNameAr,
  divisionNameEn,
  darkMode,
  onToggleDark,
  onAuthenticated,
}: AuthScreenProps) {
  const [username, setUsername] = useState(needsSetup ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullNameAr, setFullNameAr] = useState(needsSetup ? 'م. حيدر عبد الكريم الموسوي' : '');
  const [fullNameEn, setFullNameEn] = useState(needsSetup ? 'Eng. Haider Al-Mousawi' : '');
  const [email, setEmail] = useState(needsSetup ? 'manager@pvt-div.local' : '');
  const [loadSampleData, setLoadSampleData] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (needsSetup) {
      if (!username.trim() || !fullNameAr.trim() || !password) {
        setError('يرجى تعبئة جميع الحقول الإلزامية لإنشاء حساب مدير الشعبة.');
        return;
      }
      if (password !== confirmPassword) {
        setError('كلمتا المرور غير متطابقتين.');
        return;
      }
      setSubmitting(true);
      try {
        const res = await apiRequest<{ token: string; user: AuthUser }>('/auth/setup', {
          method: 'POST',
          body: {
            username,
            password,
            fullNameAr,
            fullNameEn,
            email,
            loadSampleData,
          },
        });
        setAuthToken(res.token);
        onAuthenticated(res.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر إكمال الإعداد الأولي.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!username.trim() || !password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F3F6F9] dark:bg-[#101A24] text-[#233747] dark:text-[#E8EEF3]">
      {/* Corporate Petroleum Brand Panel */}
      <aside className="lg:w-[44%] bg-[#102638] dark:bg-[#0B1520] text-white p-8 lg:p-14 flex flex-col justify-between relative overflow-hidden">
        {/* Subtle geometric oil-industry grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, #DDF2F0 1px, transparent 1px), linear-gradient(to bottom, #DDF2F0 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-[#17445C] border border-[#C99A45]/50 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 36 36" className="w-6 h-6 text-[#E5B65C]" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 4L30 11V25L18 32L6 25V11L18 4Z" />
                <path d="M18 10V26M12 14.5L18 18L24 14.5" stroke="#078C8C" strokeWidth="2" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-[#A9B7C4] font-medium">{companyNameAr}</p>
              <p className="text-sm font-bold tracking-tight text-white">{divisionNameAr}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleDark}
            aria-label={darkMode ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
            className="p-2.5 min-w-[44px] min-h-[44px] rounded-md bg-[#17445C]/70 hover:bg-[#203C50] text-[#E8EEF3] inline-flex items-center justify-center transition-colors"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <div className="relative z-10 my-10 lg:my-0 space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-mono tracking-wider text-[#E5B65C]" dir="ltr">
              {divisionNameEn.toUpperCase()}
            </p>
            <h1 className="text-2xl lg:text-3xl font-bold leading-snug text-white">
              نظام الإدارة الإداري المتكامل لشعبة موائع المكامن (PVT)
            </h1>
            <p className="text-sm text-[#A9B7C4] leading-relaxed max-w-md">
              منصة مركزية آمنة تعمل بالكامل داخل الشبكة المحلية للشركة دون الحاجة لاتصال بالإنترنت،
              لتنظيم شؤون الملاك الوظيفي، المعدات والأصول، الصيانة والمعايرة، أرشيف الوثائق،
              المراسلات، المخزون، والنسخ الاحتياطي الموثّق.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10 text-xs text-[#DDF2F0]">
            <div className="space-y-1">
              <p className="font-semibold text-white">تشغيل محلي كامل (LAN)</p>
              <p className="text-[#A9B7C4]">قاعدة بيانات SQLite مركزية بوضع WAL بدون أي اعتماد خارجي.</p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-white">صلاحيات وتدقيق شامل</p>
              <p className="text-[#A9B7C4]">تشفير كلمات المرور، فصل أدوار المدير والمهندس والمستعرض، وسجل تدقيق غير قابل للتعديل.</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 pt-6 border-t border-white/10 flex items-start gap-2.5 text-xs text-[#A9B7C4]">
          <ShieldCheck className="w-4 h-4 text-[#C99A45] shrink-0 mt-0.5" />
          <p>
            تنبيه أمني: هذا النظام مخصص للاستخدام الداخلي فقط. يجب تأمين الحاسوب الخادم المركزي
            والشبكة المحلية (LAN) بجدار حماية يمنع الوصول من الشبكات العامة.
          </p>
        </div>
      </aside>

      {/* Form Panel */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-md bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg p-7 sm:p-8 shadow-sm">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#078C8C] dark:text-teal-300 mb-2">
              {needsSetup ? <UserCheck className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              <span>{needsSetup ? 'التهيئة الأولية للخادم المركزي' : 'بوابة الدخول المصرح بها'}</span>
            </div>
            <h2 className="text-2xl font-bold text-[#102638] dark:text-[#E8EEF3]">
              {needsSetup ? 'إعداد حساب مدير الشعبة الأول' : 'تسجيل الدخول إلى النظام'}
            </h2>
            <p className="text-sm text-[#718096] dark:text-[#A9B7C4] mt-1">
              {needsSetup
                ? 'لا توجد كلمات مرور افتراضية ثابتة. أنشئ حساب المدير العام الأول لتفعيل النظام وإغلاق صفحة الإعداد تلقائياً.'
                : 'أدخل بيانات حسابك الصادرة من إدارة الشعبة للوصول إلى لوحة العمل.'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-md text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="auth-username" className="block text-sm font-medium mb-1.5">
                اسم المستخدم <span className="text-red-600">*</span>
              </label>
              <input
                id="auth-username"
                type="text"
                dir="ltr"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full px-3.5 py-2.5 min-h-[44px] text-sm text-left font-mono rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] focus:border-[#078C8C] focus:outline-none"
                required
              />
            </div>

            {needsSetup && (
              <>
                <div>
                  <label htmlFor="auth-fullname-ar" className="block text-sm font-medium mb-1.5">
                    الاسم الكامل (بالعربية) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="auth-fullname-ar"
                    type="text"
                    value={fullNameAr}
                    onChange={(e) => setFullNameAr(e.target.value)}
                    placeholder="مثال: م. حيدر عبد الكريم الموسوي"
                    className="w-full px-3.5 py-2.5 min-h-[44px] text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] focus:border-[#078C8C] focus:outline-none"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="auth-fullname-en" className="block text-sm font-medium mb-1.5">
                      الاسم (بالإنجليزية)
                    </label>
                    <input
                      id="auth-fullname-en"
                      type="text"
                      dir="ltr"
                      value={fullNameEn}
                      onChange={(e) => setFullNameEn(e.target.value)}
                      placeholder="Eng. Full Name"
                      className="w-full px-3.5 py-2.5 min-h-[44px] text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] focus:border-[#078C8C] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="auth-email" className="block text-sm font-medium mb-1.5">
                      البريد الداخلي
                    </label>
                    <input
                      id="auth-email"
                      type="email"
                      dir="ltr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="manager@pvt.local"
                      className="w-full px-3.5 py-2.5 min-h-[44px] text-sm text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] focus:border-[#078C8C] focus:outline-none"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-password" className="block text-sm font-medium mb-1.5">
                كلمة المرور <span className="text-red-600">*</span>
              </label>
              <input
                id="auth-password"
                type="password"
                dir="ltr"
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 min-h-[44px] text-sm text-left font-mono rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] focus:border-[#078C8C] focus:outline-none"
                required
              />
              {needsSetup && (
                <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-1">
                  8 أحرف على الأقل وتتضمن أحرفاً وأرقاماً معاً.
                </p>
              )}
            </div>

            {needsSetup && (
              <>
                <div>
                  <label htmlFor="auth-confirm" className="block text-sm font-medium mb-1.5">
                    تأكيد كلمة المرور <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="auth-confirm"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 min-h-[44px] text-sm text-left font-mono rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] focus:border-[#078C8C] focus:outline-none"
                    required
                  />
                </div>

                <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={loadSampleData}
                    onChange={(e) => setLoadSampleData(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-[#078C8C]"
                  />
                  <span className="text-xs text-[#233747] dark:text-[#A9B7C4] leading-relaxed">
                    تهيئة سجل تشغيلي ابتدائي لقاعدة البيانات (موظفون، معدات، أوامر صيانة، معايرة، أرشيف، ومخزون) لاختبار جميع الوحدات مباشرة.
                  </span>
                </label>
              </>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 min-h-[46px] text-sm font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] dark:hover:bg-[#067575] text-white transition-colors disabled:opacity-60"
            >
              {submitting
                ? 'جارٍ التحقق والتشغيل...'
                : needsSetup
                  ? 'إنشاء حساب المدير وتفعيل النظام'
                  : 'تسجيل الدخول'}
            </button>
          </form>

          {!needsSetup && (
            <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-6 text-center">
              التسجيل العام معطّل لأغراض أمنية. يتم إنشاء الحسابات حصراً عبر مدير الشعبة.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
