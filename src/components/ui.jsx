import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, X, Loader2 } from 'lucide-react';

// ---------- Toasts ----------
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, message, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const api = useMemo(() => ({ ok: (m) => push(m, 'ok'), error: (m) => push(m, 'error') }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${t.kind === 'error' ? 'border-red-200 bg-red-50 text-bad' : 'border-emerald-200 bg-white text-ink'}`}>
            {t.kind === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />}
            <span className="break-words">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Primitives ----------
export function Spinner({ className = '' }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} aria-label="Loading" />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center text-slate2">
      <Spinner className="mr-2" /> Loading…
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate2 hover:bg-mist" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-display text-base font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  const color = tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : 'text-ink';
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-slate2">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const JOB_BADGE = {
  queued: ['badge-info', 'Queued'],
  sending: ['badge-info', 'Sending'],
  sent: ['badge-ok', 'Sent'],
  failed: ['badge-bad', 'Failed'],
  bounced: ['badge-bad', 'Rejected'],
  cancelled: ['badge-muted', 'Cancelled'],
};
export function JobBadge({ status }) {
  if (!status) return <span className="badge badge-muted">Not sent</span>;
  const [cls, label] = JOB_BADGE[status] || ['badge-muted', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function CertBadge({ status }) {
  if (!status) return <span className="badge badge-muted">Pending</span>;
  if (status === 'revoked') return <span className="badge badge-bad">Revoked</span>;
  return <span className="badge badge-ok">Issued</span>;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}