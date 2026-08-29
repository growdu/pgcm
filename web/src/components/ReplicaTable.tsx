import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';
import { useApp, currentSnapshot } from '../store';
import { useT } from '../i18n';
import { formatInterval, severityColor } from '../lib/format';
import type { PhysicalReplicaStat } from '../types';
import { LagTrendMiniChart } from './LagTrendMiniChart';

// ─── Tiny inline LSN cell ──────────────────────────────────────────────
function LsnText({ value }: { value: string }) {
  return <span className="font-mono text-xs whitespace-nowrap">{value || '—'}</span>;
}

// ─── State badge colors (per UI spec §6.1) ─────────────────────────────
function stateBadgeClass(state: string): string {
  switch (state) {
    case 'streaming':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
    case 'catchup':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
    default:
      // startup / backup / stopping
      return 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
  }
}

// ─── sync_state badge colors (per UI spec §6.1) ────────────────────────
function syncStateBadgeClass(sync: string): string {
  switch (sync) {
    case 'sync':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
    case 'potential':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
    case 'quorum':
      return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
    case 'async':
    default:
      return 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
  }
}

// ─── Lag colour by threshold ───────────────────────────────────────────
// Returns one of ok / warn / alert / critical for a numeric lag in
// seconds, given a {warn, alert, critical} threshold triple.
type LagSeverity = 'ok' | 'warn' | 'alert' | 'critical';
function lagSeverity(seconds: number, t: { warn: number; alert: number; critical: number }): LagSeverity {
  const s = Math.max(seconds, 0);
  if (s >= t.critical) return 'critical';
  if (s >= t.alert) return 'alert';
  if (s >= t.warn) return 'warn';
  return 'ok';
}
function lagClass(sev: LagSeverity): string {
  switch (sev) {
    case 'critical':
      return 'text-red-700 dark:text-red-300 font-semibold';
    case 'alert':
      return 'text-red-600 dark:text-red-400 font-medium';
    case 'warn':
      return 'text-amber-600 dark:text-amber-400 font-medium';
    default:
      return 'text-gray-700 dark:text-gray-300';
  }
}

// ─── Reusable badge shell ──────────────────────────────────────────────
function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border tracking-wide',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ReplicaTable() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const thresholds = useApp((s) => s.thresholds);
  const snap = useApp(currentSnapshot);

  // Set of application_names whose row is currently expanded.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (appName: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(appName)) next.delete(appName);
      else next.add(appName);
      return next;
    });

  // No data → parent decides visibility; we return null per spec.
  if (!snap || !snap.physical || snap.physical.replicas.length === 0) return null;

  const replicas = snap.physical.replicas;

 // Threshold resolution: write_lag / flush_lag share
 // replica_write_lag_seconds; replay_lag uses replica_replay_lag_seconds.
 const writeLagTh = thresholds.replica_write_lag_seconds;
 const replayLagTh = thresholds.replica_replay_lag_seconds;

 const columns: Array<{ key: string; label: string; className?: string }> = [
 { key: '_expand', label: '', className: 'w-6' },
 { key: 'application_name', label: t.replicaTable.col_app, className: 'min-w-[140px]' },
 { key: 'client_addr', label: t.replicaTable.col_addr, className: 'min-w-[120px]' },
 { key: 'state', label: t.replicaTable.col_state, className: 'w-24' },
 { key: 'sync_state', label: t.replicaTable.col_sync, className: 'w-24' },
 { key: 'sent_lsn', label: t.replicaTable.col_sent, className: 'w-32' },
 { key: 'write_lsn', label: t.replicaTable.col_write, className: 'w-32' },
 { key: 'flush_lsn', label: t.replicaTable.col_flush, className: 'w-32' },
 { key: 'replay_lsn', label: t.replicaTable.col_replay, className: 'w-32' },
 { key: 'write_lag', label: t.replicaTable.col_writeLag, className: 'w-24' },
 { key: 'flush_lag', label: t.replicaTable.col_flushLag, className: 'w-24' },
 { key: 'replay_lag', label: t.replicaTable.col_replayLag, className: 'w-24' },
 { key: 'backend_start', label: t.replicaTable.col_backend, className: 'w-28' },
 { key: 'reply_time', label: t.replicaTable.col_reply, className: 'w-24' },
 { key: 'severity', label: t.replicaTable.col_severity, className: 'w-24' },
 ];

 return (
 <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
 <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
 <div className="flex items-center gap-2 text-sm font-medium">
 <Database className="w-4 h-4 text-gray-500" />
 {t.replicaTable.title}
 <span className="text-xs text-gray-500">({replicas.length})</span>
 </div>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full text-xs">
 <thead>
 <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
 {columns.map((c) => (
 <th
 key={c.key}
 className={clsx('text-left font-medium px-3 py-2 border-b border-gray-200 dark:border-gray-800', c.className)}
 >
 {c.label}
 </th>
 ))}
 </tr>
 </thead>
 <tbody>
 {replicas.map((r) => {
 const isOpen = expanded.has(r.application_name);
 const writeSev = lagSeverity(r.write_lag_seconds ?? 0, writeLagTh);
 const flushSev = lagSeverity(r.flush_lag_seconds ?? 0, writeLagTh);
 const replaySev = lagSeverity(r.replay_lag_seconds ?? 0, replayLagTh);
 return (
 <FragmentRow
 key={r.application_name}
 replica={r}
 isOpen={isOpen}
 onToggle={() => toggle(r.application_name)}
 writeSev={writeSev}
 flushSev={flushSev}
 replaySev={replaySev}
 lang={lang}
 t={t}
 />
 );
 })}
 </tbody>
 </table>
 </div>
 </div>
 );
}

// ─── One row + optional expanded chart row ─────────────────────────────
function FragmentRow({
 replica,
 isOpen,
 onToggle,
 writeSev,
 flushSev,
 replaySev,
 lang,
 t,
 }: {
 replica: PhysicalReplicaStat;
 isOpen: boolean;
 onToggle: () => void;
 writeSev: LagSeverity;
 flushSev: LagSeverity;
 replaySev: LagSeverity;
 lang: 'zh' | 'en';
 t: ReturnType<typeof useT>;
 }) {
 return (
 <>
 <tr
 onClick={onToggle}
 className={clsx(
 'border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors',
 'hover:bg-gray-50 dark:hover:bg-gray-900/40',
 )}
 >
 <td className="px-3 py-2 align-middle">
 {isOpen ? (
 <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
 ) : (
 <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
 )}
 </td>
 <td className="px-3 py-2 align-middle font-medium text-gray-800 dark:text-gray-200">
 {replica.application_name || <span className="text-gray-400">—</span>}
 </td>
 <td className="px-3 py-2 align-middle font-mono text-xs text-gray-600 dark:text-gray-400">
 {replica.client_addr || '—'}
 </td>
 <td className="px-3 py-2 align-middle">
 <Pill className={stateBadgeClass(replica.state)}>{replica.state || '—'}</Pill>
 </td>
 <td className="px-3 py-2 align-middle">
 <Pill className={syncStateBadgeClass(replica.sync_state)}>{replica.sync_state || '—'}</Pill>
 </td>
 <td className="px-3 py-2 align-middle">
 <LsnText value={replica.sent_lsn} />
 </td>
 <td className="px-3 py-2 align-middle">
 <LsnText value={replica.write_lsn} />
 </td>
 <td className="px-3 py-2 align-middle">
 <LsnText value={replica.flush_lsn} />
 </td>
 <td className="px-3 py-2 align-middle">
 <LsnText value={replica.replay_lsn} />
 </td>
 <td className={clsx('px-3 py-2 align-middle', lagClass(writeSev))}>
 {formatInterval(replica.write_lag_seconds)}
 </td>
 <td className={clsx('px-3 py-2 align-middle', lagClass(flushSev))}>
 {formatInterval(replica.flush_lag_seconds)}
 </td>
 <td className={clsx('px-3 py-2 align-middle', lagClass(replaySev))}>
 {formatInterval(replica.replay_lag_seconds)}
 </td>
 <td className="px-3 py-2 align-middle text-gray-600 dark:text-gray-400">
 {replica.backend_start_ago || '—'}
 </td>
 <td className="px-3 py-2 align-middle text-gray-600 dark:text-gray-400">
 {replica.reply_time_ago || '—'}
 </td>
 <td className={clsx('px-3 py-2 align-middle uppercase tracking-wide', severityColor(replica.severity))}>
 {replica.severity || (lang === 'zh' ? '无数据' : t.noData)}
 </td>
 </tr>

 {isOpen && (
 <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/30">
 <td colSpan={15} className="px-4 py-3">
 <LagTrendMiniChart replica={replica} />
 </td>
 </tr>
 )}
 </>
 );
}

