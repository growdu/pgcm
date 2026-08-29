import clsx from 'clsx';
import type { ErrorStat, Thresholds } from '../types';
import { useT } from '../i18n';

interface Props {
  errors: ErrorStat[];
  thresholds: Thresholds;
  subname?: string;
}

function severityForCount(
  n: number,
  thr: { warn: number; alert: number; critical: number },
): 'ok' | 'warn' | 'alert' | 'critical' {
  if (n >= thr.critical) return 'critical';
  if (n >= thr.alert) return 'alert';
  if (n >= thr.warn) return 'warn';
  return 'ok';
}

function severityStyle(sev: string): string {
  switch (sev) {
    case 'critical':
      return 'bg-red-900 text-white border-red-700';
    case 'alert':
      return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-300 dark:border-red-800';
    case 'warn':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-800';
    default:
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900';
  }
}

type ConflFieldKey =
  | 'confl_insert_exists'
  | 'confl_update_exists'
  | 'confl_update_missing'
  | 'confl_delete_missing'
  | 'confl_multiple_unique_conflicts';

const CONFL_FIELDS: ConflFieldKey[] = [
  'confl_insert_exists',
  'confl_update_exists',
  'confl_update_missing',
  'confl_delete_missing',
  'confl_multiple_unique_conflicts',
];

function conflLabel(t: ReturnType<typeof useT>, k: ConflFieldKey): string {
  return (t.errorGrid as Record<string, string>)[k] ?? k;
}

export function ErrorGrid({ errors, thresholds, subname }: Props) {
  const t = useT();

  if (!errors || errors.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic p-2 border rounded my-1 border-gray-200 dark:border-gray-800">
        {t.noData}
      </div>
    );
  }

  const counts: Record<ConflFieldKey, number> = {
    confl_insert_exists: 0,
    confl_update_exists: 0,
    confl_update_missing: 0,
    confl_delete_missing: 0,
    confl_multiple_unique_conflicts: 0,
  };
  let applyErr = 0;
  let syncErr = 0;
  for (const e of errors) {
    applyErr += e.apply_error_count || 0;
    syncErr += e.sync_error_count || 0;
    for (const k of CONFL_FIELDS) {
      const v = (e as unknown as Record<string, number>)[k] || 0;
      counts[k] += v;
    }
  }

  const applySev = severityForCount(applyErr, thresholds.apply_error_count_5m);
  const totalConflicts = CONFL_FIELDS.reduce((sum, k) => sum + counts[k], 0);
  const conflictSev = severityForCount(totalConflicts, thresholds.conflict_count_5m);

  return (
    <div className="p-2 border rounded my-1 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="text-xs font-semibold text-gray-500 mb-1">
        {t.errorGrid.title}
        {subname ? <span className="ml-1 text-gray-400">({subname})</span> : null}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
        <Card label={t.errorGrid.applyError} value={applyErr} severity={applySev} />
        <Card
          label={t.errorGrid.syncError}
          value={syncErr}
          severity={syncErr > 0 ? 'warn' : 'ok'}
        />
        <div className="col-span-2 flex flex-wrap gap-1 items-center">
          {CONFL_FIELDS.map((k) => {
            const v = counts[k];
            const sev = severityForCount(v, thresholds.conflict_count_5m);
            return (
              <span
                key={k}
                className={clsx(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border',
                  severityStyle(sev),
                )}
                title={conflLabel(t, k)}
              >
                <span className="font-mono">{conflLabel(t, k)}</span>
                <span className="font-mono">{v}</span>
              </span>
            );
          })}
          <span
            className={clsx(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border',
              severityStyle(conflictSev),
            )}
            title="conflicts total"
          >
            <span>total</span>
            <span className="font-mono">{totalConflicts}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  severity,
}: {
  label: string;
  value: number;
  severity: 'ok' | 'warn' | 'alert' | 'critical';
}) {
  return (
    <div className={clsx('rounded border px-2 py-1 flex flex-col', severityStyle(severity))}>
      <span className="text-[10px] opacity-80">{label}</span>
      <span className="text-base font-semibold font-mono">{value}</span>
    </div>
  );
}
