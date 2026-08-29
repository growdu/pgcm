import clsx from 'clsx';

export type SeverityKind = 'ok' | 'warn' | 'alert' | 'critical' | 'unknown';

const SEVERITY_STYLES: Record<SeverityKind, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-800',
  alert: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-300 dark:border-red-800',
  critical: 'bg-red-900 text-white dark:bg-red-950 border-red-700 dark:border-red-700',
  unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-300 dark:border-gray-700',
};

const SEVERITY_LABEL: Record<SeverityKind, { zh: string; en: string }> = {
  ok: { zh: 'OK', en: 'OK' },
  warn: { zh: 'WARN', en: 'WARN' },
  alert: { zh: 'ALERT', en: 'ALERT' },
  critical: { zh: 'CRITICAL', en: 'CRITICAL' },
  unknown: { zh: '—', en: '—' },
};

export function severityKindOf(s?: string | null): SeverityKind {
  switch (s) {
    case 'ok':
    case 'warn':
    case 'alert':
    case 'critical':
      return s;
    default:
      return 'unknown';
  }
}

export function SeverityBadge({ severity, lang }: { severity?: string | null; lang: 'zh' | 'en' }) {
  const k = severityKindOf(severity);
  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wide',
        SEVERITY_STYLES[k],
      )}
      title={k}
    >
      {SEVERITY_LABEL[k][lang]}
    </span>
  );
}

export function SeverityDot({ severity, title }: { severity?: string | null; title?: string }) {
  const k = severityKindOf(severity);
  const dotCls =
    k === 'ok'
      ? 'bg-emerald-500'
      : k === 'warn'
      ? 'bg-amber-500'
      : k === 'alert'
      ? 'bg-red-500'
      : k === 'critical'
      ? 'bg-red-900'
      : 'bg-gray-400';
  return <span className={clsx('inline-block w-2 h-2 rounded-full', dotCls)} title={title ?? k} />;
}
