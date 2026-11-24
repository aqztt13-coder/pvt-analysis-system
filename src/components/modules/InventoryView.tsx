import React, { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, FileSpreadsheet, Plus, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { AuthUser, InventoryItem, InventoryTransaction } from '../../shared/types';
import { DataTable } from '../DataTable';
import { Modal } from '../Modal';
import { PrintReportModal } from '../PrintReportModal';
import { StatusBadge } from '../StatusBadge';

export function InventoryView({
  user,
  onToast,
}: {
  user: AuthUser;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<'items' | 'history'>('items');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemModal, setItemModal] = useState(false);
  const [txTarget, setTxTarget] = useState<InventoryItem | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const [itemForm, setItemForm] = useState({
    itemCode: '',
    nameAr: '',
    category: 'قطع غيار ومستهلكات',
    description: '',
    unit: 'قطعة',
    quantity: 0,
    minStock: 5,
    storageLocation: '',
    supplier: '',
    expiryDate: '',
  });
  const [txForm, setTxForm] = useState({
    txType: 'issue' as 'receipt' | 'issue' | 'adjustment',
    amount: 1,
    referenceNo: '',
    reason: '',
  });

  const canWrite = user.role === 'manager' || user.role === 'engineer';
  const isManager = user.role === 'manager';
  const today = new Date().toISOString().slice(0, 10);

  const load = () => {
    setLoading(true);
    apiRequest<{ items: InventoryItem[]; transactions: InventoryTransaction[] }>('/inventory')
      .then((res) => {
        setItems(res.items);
        setTransactions(res.transactions);
      })
      .catch((err) => onToast(err.message, 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const submitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/inventory', { method: 'POST', body: itemForm });
      onToast('تم تسجيل الصنف المخزني الجديد بنجاح.');
      setItemModal(false);
      setItemForm((f) => ({ ...f, itemCode: '', nameAr: '', description: '', quantity: 0 }));
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'فشل إضافة الصنف.', 'err');
    }
  };

  const submitTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txTarget) return;
    try {
      await apiRequest(`/inventory/${txTarget.id}/transaction`, {
        method: 'POST',
        body: { ...txForm, amount: Number(txForm.amount) },
      });
      onToast('تم توثيق حركة المخزون وتحديث الرصيد بنجاح.');
      setTxTarget(null);
      setTxForm({ txType: 'issue', amount: 1, referenceNo: '', reason: '' });
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تنفيذ حركة المخزون.', 'err');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102638] dark:text-[#E8EEF3]">إدارة المخزون والمستهلكات</h2>
          <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">
            ضبط أرصدة المواد المستهلكة ومعدات السلامة مع إلزامية توثيق كل حركة استلام أو صرف أو جرد في سجل الحركات.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] bg-white dark:bg-[#192735] whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#078C8C]" />
            <span>تقرير جرد المخزون</span>
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={() => {
                setItemForm((f) => ({ ...f, itemCode: `CON-${String(items.length + 1).padStart(3, '0')}` }));
                setItemModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs font-semibold rounded-md bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة صنف جديد</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setTab('items')}
          className={`px-4 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
            tab === 'items' ? 'bg-[#102638] dark:bg-[#078C8C] text-white' : 'text-[#718096]'
          }`}
        >
          الأصناف والأرصدة ({items.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`px-4 py-2 text-xs font-semibold rounded-md whitespace-nowrap ${
            tab === 'history' ? 'bg-[#102638] dark:bg-[#078C8C] text-white' : 'text-[#718096]'
          }`}
        >
          سجل الحركات المخزنية ({transactions.length})
        </button>
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] animate-pulse" />
      ) : tab === 'items' ? (
        <DataTable
          rows={items}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث برمز الصنف أو الاسم أو التصنيف أو الموقع..."
          searchFilter={(r, q) => `${r.itemCode} ${r.nameAr} ${r.category} ${r.storageLocation}`.toLowerCase().includes(q)}
          columns={[
            {
              key: 'code',
              header: 'رمز الصنف',
              render: (r) => <span className="font-mono text-xs font-semibold text-[#078C8C]" dir="ltr">{r.itemCode}</span>,
            },
            {
              key: 'name',
              header: 'اسم المادة والتصنيف',
              render: (r) => (
                <div>
                  <p className="font-semibold text-xs">{r.nameAr}</p>
                  <p className="text-[11px] text-[#718096]">{r.category} · {r.storageLocation}</p>
                </div>
              ),
            },
            {
              key: 'qty',
              header: 'الرصيد / الحد الأدنى',
              render: (r) => {
                const low = r.quantity <= r.minStock;
                return (
                  <div className="tabular-nums text-xs">
                    <span className={`font-mono font-bold text-sm ${low ? 'text-red-700 dark:text-red-400' : 'text-[#102638] dark:text-white'}`}>
                      {r.quantity}
                    </span>{' '}
                    <span>{r.unit}</span>
                    <span className="text-[#718096] mr-1">(أدنى: {r.minStock})</span>
                  </div>
                );
              },
            },
            {
              key: 'exp',
              header: 'الصلاحية',
              mobileHidden: true,
              render: (r) => (
                <span className={`font-mono text-xs tabular-nums ${r.expiryDate && r.expiryDate < today ? 'text-red-700 font-bold' : ''}`}>
                  {r.expiryDate || 'غير محددة'}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'حالة الرصيد',
              render: (r) => (
                <StatusBadge
                  status={r.quantity === 0 ? 'critical' : r.quantity <= r.minStock ? 'warning' : 'active'}
                  customLabel={r.quantity === 0 ? 'نافذ' : r.quantity <= r.minStock ? 'منخفض' : 'متوفر'}
                />
              ),
            },
            {
              key: 'act',
              header: 'حركة مخزنية',
              render: (r) =>
                canWrite ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTxTarget(r);
                      setTxForm({ txType: 'issue', amount: 1, referenceNo: '', reason: '' });
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] text-white whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>صرف / استلام</span>
                  </button>
                ) : (
                  <span className="text-xs text-[#718096]">عرض فقط</span>
                ),
            },
          ]}
        />
      ) : (
        <DataTable
          rows={transactions}
          rowKey={(r) => r.id}
          searchPlaceholder="بحث باسم المادة أو رقم المستند أو المنفذ..."
          searchFilter={(r, q) => `${r.itemCode} ${r.itemName} ${r.referenceNo} ${r.reason} ${r.performedBy}`.toLowerCase().includes(q)}
          columns={[
            { key: 'date', header: 'التاريخ', render: (r) => <span className="font-mono text-xs tabular-nums" dir="ltr">{r.createdAt.slice(0, 16)}</span> },
            { key: 'item', header: 'الصنف', render: (r) => <div className="text-xs"><p className="font-semibold">{r.itemName}</p><p className="font-mono text-[11px] text-[#718096]" dir="ltr">{r.itemCode}</p></div> },
            {
              key: 'type',
              header: 'نوع الحركة',
              render: (r) => (
                <span className={`inline-flex items-center gap-1 text-xs font-semibold ${r.txType === 'receipt' ? 'text-emerald-700 dark:text-emerald-400' : r.txType === 'issue' ? 'text-amber-700 dark:text-amber-400' : 'text-[#078C8C]'}`}>
                  {r.txType === 'receipt' ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                  {r.txType === 'receipt' ? 'استلام مخزني' : r.txType === 'issue' ? 'صرف مخزني' : 'تسوية جردية'}
                </span>
              ),
            },
            {
              key: 'delta',
              header: 'الكمية والرصيد بعد الحركة',
              render: (r) => (
                <span className="font-mono text-xs tabular-nums" dir="ltr">
                  {r.quantityDelta > 0 ? `+${r.quantityDelta}` : r.quantityDelta} → ({r.balanceAfter})
                </span>
              ),
            },
            { key: 'reason', header: 'السبب والمستند', render: (r) => <div className="text-xs"><p>{r.reason}</p>{r.referenceNo && <p className="font-mono text-[11px] text-[#718096]">مستند: {r.referenceNo}</p>}</div> },
            { key: 'by', header: 'المنفّذ', render: (r) => <span className="text-xs">{r.performedBy}</span> },
          ]}
        />
      )}

      {/* Add Item Modal */}
      <Modal open={itemModal} onClose={() => setItemModal(false)} title="إضافة صنف مخزني جديد" size="lg">
        <form onSubmit={submitItem} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">رمز الصنف *</label>
              <input type="text" dir="ltr" required value={itemForm.itemCode} onChange={(e) => setItemForm({ ...itemForm, itemCode: e.target.value })} className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم المادة *</label>
              <input type="text" required value={itemForm.nameAr} onChange={(e) => setItemForm({ ...itemForm, nameAr: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التصنيف</label>
              <select value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]">
                <option value="قطع غيار ومستهلكات">قطع غيار ومستهلكات</option>
                <option value="معدات وقاية شخصية PPE">معدات وقاية شخصية PPE</option>
                <option value="قرطاسية ومستلزمات إدارية">قرطاسية ومستلزمات إدارية</option>
                <option value="مواد نظافة وخدمات">مواد نظافة وخدمات</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">وحدة القياس</label>
              <input type="text" value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الرصيد الافتتاحي</label>
              <input type="number" min={0} value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: Number(e.target.value) })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الحد الأدنى للتنبيه</label>
              <input type="number" min={0} value={itemForm.minStock} onChange={(e) => setItemForm({ ...itemForm, minStock: Number(e.target.value) })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">موقع التخزين</label>
              <input type="text" value={itemForm.storageLocation} onChange={(e) => setItemForm({ ...itemForm, storageLocation: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">تاريخ الانتهاء (إن وجد)</label>
              <input type="date" value={itemForm.expiryDate} onChange={(e) => setItemForm({ ...itemForm, expiryDate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setItemModal(false)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#17445C] text-white">حفظ الصنف</button>
          </div>
        </form>
      </Modal>

      {/* Audited Stock Movement Modal */}
      <Modal
        open={Boolean(txTarget)}
        onClose={() => setTxTarget(null)}
        title={`تسجيل حركة مخزنية: ${txTarget?.nameAr || ''}`}
        subtitle={`الرصيد الحالي: ${txTarget?.quantity ?? 0} ${txTarget?.unit || ''}`}
        size="md"
      >
        <form onSubmit={submitTx} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">نوع الحركة *</label>
            <select
              value={txForm.txType}
              onChange={(e) => setTxForm({ ...txForm, txType: e.target.value as 'receipt' | 'issue' | 'adjustment' })}
              className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]"
            >
              <option value="receipt">استلام / توريد مخزني (+)</option>
              <option value="issue">صرف مستهلكات (-)</option>
              {isManager && <option value="adjustment">تسوية جردية فعلية (للمدير)</option>}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">
                {txForm.txType === 'adjustment' ? 'الرصيد الفعلي الجديد *' : 'الكمية *'}
              </label>
              <input type="number" min={txForm.txType === 'adjustment' ? 0 : 1} required value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: Number(e.target.value) })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">رقم المستند (اختياري)</label>
              <input type="text" dir="ltr" value={txForm.referenceNo} onChange={(e) => setTxForm({ ...txForm, referenceNo: e.target.value })} placeholder="ISS-2026-11" className="w-full px-3 py-2 text-sm font-mono text-left rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">سبب الحركة / الجهة المستلمة *</label>
            <textarea rows={2} required value={txForm.reason} onChange={(e) => setTxForm({ ...txForm, reason: e.target.value })} className="w-full px-3 py-2 text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTxTarget(null)} className="px-4 py-2 text-sm rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D]">إلغاء</button>
            <button type="submit" className="px-5 py-2 text-sm font-semibold rounded-md bg-[#078C8C] text-white">تثبيت الحركة</button>
          </div>
        </form>
      </Modal>

      <PrintReportModal open={reportOpen} onClose={() => setReportOpen(false)} moduleKey="inventory" canExport={user.role !== 'viewer'} />
    </div>
  );
}
