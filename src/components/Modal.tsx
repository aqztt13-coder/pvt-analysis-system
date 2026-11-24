import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'md' | 'lg' | 'xl';
  printable?: boolean;
  children: React.ReactNode;
}

const SIZE_MAP = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, subtitle, size = 'lg', printable = false, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#102638]/60 backdrop-blur-[1px] ${
        printable ? 'print-modal-root' : 'no-print'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${SIZE_MAP[size]} max-h-[90vh] flex flex-col bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg shadow-xl ${
          printable ? 'print-modal-card' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#DFE6EC] dark:border-[#2C3D4D] no-print">
          <div>
            <h2 className="text-lg font-bold text-[#102638] dark:text-[#E8EEF3]">{title}</h2>
            {subtitle && (
              <p className="text-xs text-[#718096] dark:text-[#A9B7C4] mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="p-2 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-md text-[#718096] hover:text-[#102638] dark:hover:text-white hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className={`p-6 overflow-y-auto flex-1 ${printable ? 'print-modal-body' : ''}`}>{children}</div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'تأكيد الإجراء',
  danger = false,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <p className="text-sm text-[#233747] dark:text-[#E8EEF3] leading-relaxed mb-6">{message}</p>
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2.5 min-h-[42px] text-sm font-medium rounded-md border border-[#DFE6EC] dark:border-[#2C3D4D] text-[#233747] dark:text-[#E8EEF3] hover:bg-[#F3F6F9] dark:hover:bg-[#203C50] transition-colors whitespace-nowrap"
        >
          إلغاء
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`px-5 py-2.5 min-h-[42px] text-sm font-semibold rounded-md text-white transition-colors whitespace-nowrap disabled:opacity-60 ${
            danger
              ? 'bg-red-700 hover:bg-red-800'
              : 'bg-[#17445C] hover:bg-[#102638] dark:bg-[#078C8C] dark:hover:bg-[#067575]'
          }`}
        >
          {busy ? 'جارٍ التنفيذ...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
