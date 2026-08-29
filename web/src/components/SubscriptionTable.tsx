import { Fragment, useMemo, useState } from 'react';
import clsx from 'clsx';
import type {
  ErrorStat,
  SlotHealth,
  SubscriptionSummary,
  Thresholds,
  WorkerStat,
} from '../types';
import { useT } from '../i18n';
import { useApp } from '../store';
import {
  formatBytes,
  formatInterval,
  formatRate,
  severityColor,
} from '../lib/format';
import { SeverityBadge, SeverityDot } from './SeverityBadge';
import { WorkerTable } from './WorkerTable';
import { SyncMatrix } from './SyncMatrix';
import { ErrorGrid } from './ErrorGrid';
import { SlotList } from './SlotList';

// Mirrors Go SyncMatrixCell (logical.sync_matrix); not yet exported in types/index.ts.
interface SyncMatrixCell {
  subname?: string;
  srsubstate?: string;
  state_name?: string;
  table_count?: number;
  oldest_state_lsn?: string;
}

interface Props {
  subscriptions: SubscriptionSummary[];
  workers: WorkerStat[];
  errors: ErrorStat[];
  slots: SlotHealth[];
  syncMatrix?: SyncMatrixCell[];
  thresholds: Thresholds;
}

function severityForValue(v: number, thr: { warn: number; alert: number; critical: number }) {
  if (v >= thr.critical) return 'critical';
  if (v >= thr.alert) return 'alert';
  if (v >= thr.warn) return 'warn';
  return 'ok';
}

export function SubscriptionTable({
  subscriptions,
  workers,
  errors,
  slots,
  syncMatrix,
  thresholds,
}: Props) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (s: string) =>
    setExpanded((prev) => ({ ...prev, [s]: !prev[s] }));

  const workersBySub = useMemo(() => {
    const m: Record<string, WorkerStat[]> = {};
    for (const w of workers) {
      if (!w.subname) continue;
      (m[w.subname] ||= []).push(w);
    }
    return m;
  }, [workers]);

  const errorsBySub = useMemo(() => {
    const m: Record<string, ErrorStat[]> = {};
    for (const e of errors) {
      if (!e.subname) continue;
      (m[e.subname] ||= []).push(e);
    }
    return m;
  }, [errors]);

  const matrixBySub = useMemo(() => {
    const m: Record<string, SyncMatrixCell[]> = {};
    for (const c of syncMatrix || []) {
      const k = c.subname || '_global';
      (m[k] ||= []).push(c);
    }
    return m;
  }, [syncMatrix]);

  if (!subscriptions || subscriptions.length === 0) {
    return (
      <div className="p-2 border rounded my-1 border-gray-200 dark:border-gray-800">
        <div className="text-sm font-semibold text-gray-500 mb-1">{t.subTable.title}</div>
        <div className="text-xs text-gray-500 italic">{t.noData}</div>
      </div>
    );
  }

  return (
    <div className="p-2 border rounded my-1 border-gray-200 dark:border-gray-800">
      <div className="text-sm font-semibold text-gray-500 mb-1">{t.subTable.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800/40">
            <tr className="border-b border-gray-200 dark:border-gray-800 sticky top-0">
              <th className="text-left py-1 px-1">{t.subTable.col_subname}</th>
              <th className="text-center py-1 px-1">{t.subTable.col_enabled}</th>
              <th className="text-left py-1 px-1">{t.subTable.col_slot}</th>
              <th className="text-left py-1 px-1">{t.subTable.col_walStatus}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_retention}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_pubToFlush}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_flushToReceived}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_receivedToApplied}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_total}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_applyPid}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_spillPct}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_totalMbps}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_applyErrors}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_conflicts}</th>
              <th className="text-right py-1 px-1">{t.subTable.col_lastRecv}</th>
              <th className="text-center py-1 px-1">{t.subTable.col_severity}</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((s) => {
              const isOpen = !!expanded[s.subname];
              const totalConflict = Object.values(s.conflict_counts || {}).reduce(
                (a, b) => a + (b || 0),
                0
              );
              const totalSev = severityForValue(s.total_lag, thresholds.total_lag_bytes);
              const retentionSev = severityForValue(
                s.slot_wal_retention_bytes,
                thresholds.slot_wal_retention
              );
              const spillSev = severityForValue(s.spill_pct, thresholds.spill_pct);
              const applyErrSev = severityForValue(
                s.apply_error_count,
                thresholds.apply_error_count_5m
              );
              const conflictSev = severityForValue(totalConflict, thresholds.conflict_count_5m);
              const recvAgeSev = severityForValue(
                s.last_recv_age_seconds,
                thresholds.worker_last_recv_age
              );

              // composite row tint: red if worker dead, amber if recv stale
              const anyDeadWorker = (workersBySub[s.subname] || []).some((w) => !w.alive);
              const staleRecv = s.last_recv_age_seconds > 300;

              return (
                <Fragment key={s.subname}>
                  <tr
                    onClick={() => toggle(s.subname)}
                    className={clsx(
                      'border-b border-gray-100 dark:border-gray-800/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40',
                      anyDeadWorker && 'bg-red-50 dark:bg-red-950/20',
                      !anyDeadWorker && staleRecv && 'bg-amber-50 dark:bg-amber-950/20'
                    )}
                  >
                    <td className="py-1 px-1 font-mono">
                      <span className="inline-block w-3 text-gray-400">{isOpen ? '▾' : '▸'}</span>{' '}
                      {s.subname}
                    </td>
                    <td className="py-1 px-1 text-center">
                      <span
                        className={clsx(
                          'inline-block px-1.5 rounded text-[10px] font-semibold',
                          s.subenabled
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        )}
                      >
                        {s.subenabled ? '✓' : '✗'}
                      </span>
                    </td>
                    <td className="py-1 px-1 font-mono">{s.slot_name}</td>
                    <td className="py-1 px-1">
                      <span className="text-[10px] font-mono px-1 rounded bg-gray-100 dark:bg-gray-800">
                        {s.slot_wal_status}
                      </span>
                    </td>
                    <td
                      className={clsx(
                        'py-1 px-1 text-right font-mono',
                        severityColor(retentionSev)
                      )}
                    >
                      {formatBytes(s.slot_wal_retention_bytes)}
                    </td>
                    <td className="py-1 px-1 text-right font-mono">
                      {formatBytes(s.seg_pub_to_flush)}
                    </td>
                    <td className="py-1 px-1 text-right font-mono">
                      {formatBytes(s.seg_flush_to_received)}
                    </td>
                    <td className="py-1 px-1 text-right font-mono">
                      {formatBytes(s.seg_received_to_applied)}
                    </td>
                    <td
                      className={clsx(
                        'py-1 px-1 text-right font-mono font-semibold',
                        severityColor(totalSev)
                      )}
                    >
                      {formatBytes(s.total_lag)}
                    </td>
                    <td className="py-1 px-1 text-right font-mono">
                      {s.apply_worker_pid ?? '-'}
                    </td>
                    <td className={clsx('py-1 px-1 text-right', severityColor(spillSev))}>
                      {formatRate(s.spill_pct, '%')}
                    </td>
                    <td className="py-1 px-1 text-right font-mono">
                      {formatRate(s.total_mbps, 'MB/s')}
                    </td>
                    <td
                      className={clsx(
                        'py-1 px-1 text-right font-mono',
                        severityColor(applyErrSev)
                      )}
                    >
                      {s.apply_error_count}
                    </td>
                    <td
                      className={clsx(
                        'py-1 px-1 text-right font-mono',
                        severityColor(conflictSev)
                      )}
                    >
                      {totalConflict}
                    </td>
                    <td
                      className={clsx(
                        'py-1 px-1 text-right',
                        severityColor(recvAgeSev)
                      )}
                    >
                      {formatInterval(s.last_recv_age_seconds)}
                    </td>
                    <td className="py-1 px-1 text-center">
                      <SeverityDot severity={s.severity} title={`row ${s.subname}`} />
                      <SeverityBadge severity={s.severity} lang={lang} />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-50/50 dark:bg-gray-900/50">
                      <td colSpan={16} className="p-1">
                        <div className="grid grid-cols-1 gap-1">
                          <WorkerTable workers={workersBySub[s.subname] || []} />
                          <SyncMatrix
                            cells={matrixBySub[s.subname] || matrixBySub._global || []}
                            subname={s.subname}
                          />
                          <ErrorGrid
                            errors={errorsBySub[s.subname] || []}
                            thresholds={thresholds}
                            subname={s.subname}
                          />
                          <SlotList slots={slots} filterName={s.slot_name} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
