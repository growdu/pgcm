import clsx from 'clsx';
import type { WorkerStat } from '../types';
import { useT } from '../i18n';
import { useApp } from '../store';
import { formatInterval } from '../lib/format';
import { SeverityBadge } from './SeverityBadge';

interface Props {
  workers: WorkerStat[];
}

function workerTypeLabel(t: ReturnType<typeof useT>, type?: string | null): string {
  const v = (type || '').toLowerCase();
  if (v === 'apply') return t.applyWorker;
  if (v === 'table synchronization' || v === 'tablesync') return t.tablesyncWorker;
  if (v === 'parallel apply') return t.parallelApplyWorker;
  return type || '?';
}

export function WorkerTable({ workers }: Props) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  if (!workers || workers.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic p-2 border rounded my-1 border-gray-200 dark:border-gray-800">
        {t.noData}
      </div>
    );
  }

  return (
    <div className="p-2 border rounded my-1 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="text-xs font-semibold text-gray-500 mb-1">{t.workerTable.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="text-left py-1 px-1">type</th>
              <th className="text-right py-1 px-1">{t.workerTable.col_pid}</th>
              <th className="text-right py-1 px-1">{t.workerTable.col_leader}</th>
              <th className="text-left py-1 px-1">{t.workerTable.col_relid}</th>
              <th className="text-left py-1 px-1">{t.workerTable.col_recv}</th>
              <th className="text-left py-1 px-1">{t.workerTable.col_end}</th>
              <th className="text-right py-1 px-1">{t.workerTable.col_send}</th>
              <th className="text-right py-1 px-1">{t.lastRecv}</th>
              <th className="text-right py-1 px-1">{t.workerTable.col_apply}</th>
              <th className="text-center py-1 px-1">{t.alive}</th>
              <th className="text-center py-1 px-1">{t.subTable.col_severity}</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w, i) => (
              <tr
                key={`${w.pid}-${i}`}
                className={clsx(
                  'border-b border-gray-100 dark:border-gray-800/50',
                  !w.alive && 'bg-red-50 dark:bg-red-950/20',
                  w.alive && w.last_recv_age_seconds > 300 && 'bg-amber-50 dark:bg-amber-950/20'
                )}
              >
                <td className="py-1 px-1">{workerTypeLabel(t, w.worker_type)}</td>
                <td className="py-1 px-1 text-right font-mono">{w.pid || '-'}</td>
                <td className="py-1 px-1 text-right font-mono">{w.leader_pid ?? '-'}</td>
                <td className="py-1 px-1 font-mono text-gray-600 dark:text-gray-400">{w.relid ?? '-'}</td>
                <td className="py-1 px-1 font-mono">{w.received_lsn || '-'}</td>
                <td className="py-1 px-1 font-mono">{w.latest_end_lsn || '-'}</td>
                <td className="py-1 px-1 text-right">{formatInterval(w.last_send_age_seconds)}</td>
                <td className="py-1 px-1 text-right">{formatInterval(w.last_recv_age_seconds)}</td>
                <td className="py-1 px-1 text-right">{formatInterval(w.last_apply_age_seconds)}</td>
                <td className="py-1 px-1 text-center">
                  <span
                    className={clsx(
                      'inline-block px-1.5 rounded text-[10px] font-semibold',
                      w.alive
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                    )}
                  >
                    {w.alive ? t.alive : t.dead}
                  </span>
                </td>
                <td className="py-1 px-1 text-center">
                  <SeverityBadge severity={w.severity} lang={lang} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
