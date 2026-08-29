import { useApp } from '../store';
import { useT } from '../i18n';
import { formatInterval } from '../lib/format';
import type { PhysicalReplicaStat } from '../types';

/**
 * LagTrendMiniChart (v0.1 placeholder)
 *
 * The store does not yet retain a per-replica time series. Until it does,
 * we render a compact horizontal bar visualisation of the *current* lag
 * values for one replica, with vertical dashed reference lines drawn at
 * the warn / alert / critical threshold values, plus a baseline marker.
 *
 * Bar width is computed on a log10 scale so that 1 s and 900 s are both
 * legible on the same axis:
 *
 *     width = log10(seconds + 1) / log10(maxRef + 1)
 *
 * `maxRef` is the larger of the two critical thresholds so that both
 * write_lag and replay_lag criticals fit on the same axis.
 */
export function LagTrendMiniChart({ replica }: { replica: PhysicalReplicaStat }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const thresholds = useApp((s) => s.thresholds);

  // Use the union of the two threshold sets as reference levels. Both
  // DEFAULT_THRESHOLDS values are identical today (30 / 300 / 900) so we
  // draw one set of dashed lines plus a baseline marker = 4 reference
  // lines as called for by the UI spec §6.1.
  const refLevels = [
    { key: 'ok', value: 0, color: 'border-emerald-500/60', label: '0' },
    { key: 'warn', value: thresholds.replica_write_lag_seconds.warn, color: 'border-amber-500/60', label: 'W' },
    {
      key: 'alert',
      value: thresholds.replica_write_lag_seconds.alert,
      color: 'border-orange-500/60',
      label: 'A',
    },
    {
      key: 'critical',
      value: thresholds.replica_write_lag_seconds.critical,
      color: 'border-red-500/60',
      label: 'C',
    },
  ];
  const maxRef = Math.max(thresholds.replica_write_lag_seconds.critical, thresholds.replica_replay_lag_seconds.critical);

  const series: Array<{ key: string; label: string; seconds: number; color: string }> = [
    { key: 'write', label: t.replicaTable.col_writeLag, seconds: replica.write_lag_seconds ?? 0, color: 'bg-sky-500' },
    { key: 'flush', label: t.replicaTable.col_flushLag, seconds: replica.flush_lag_seconds ?? 0, color: 'bg-violet-500' },
    { key: 'replay', label: t.replicaTable.col_replayLag, seconds: replica.replay_lag_seconds ?? 0, color: 'bg-emerald-500' },
  ];

  // log10(x + 1) / log10(maxRef + 1) keeps small values readable.
  const barWidth = (seconds: number): string => {
    const safe = Math.max(seconds, 0);
    if (safe <= 0) return '0%';
    const ratio = Math.log10(safe + 1) / Math.log10(maxRef + 1);
    return `${Math.min(Math.max(ratio, 0), 1) * 100}%`;
  };

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{t.replicaTable.lagTrend}</div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400">
          {replica.application_name} · {lang === 'zh' ? '当前快照' : 'current snapshot'}
        </div>
      </div>

      <div className="relative pl-24 pr-10">
        {/* Reference lines (drawn as vertical guides over the bar lanes) */}
        <div className="absolute inset-y-0 left-24 right-10 pointer-events-none">
          {refLevels.map((lvl) => {
            const left = `${(Math.log10(lvl.value + 1) / Math.log10(maxRef + 1)) * 100}%`;
            return (
              <div
                key={lvl.key}
                className={`absolute top-0 bottom-0 border-l border-dashed ${lvl.color}`}
                style={{ left }}
                title={`${lvl.key}: ${lvl.value}s`}
              >
                <span className="absolute -top-3 -translate-x-1/2 text-[9px] font-mono text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 px-0.5 rounded">
                  {lvl.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Bars */}
        <div className="space-y-1.5">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className="w-20 text-right text-[10px] font-mono text-gray-500 dark:text-gray-400 truncate">
                {s.label}
              </div>
              <div className="flex-1 h-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div
                  className={`h-full ${s.color} transition-all`}
                  style={{ width: barWidth(s.seconds) }}
                  title={`${s.label} = ${formatInterval(s.seconds)}`}
                />
              </div>
              <div className="w-14 text-[10px] font-mono text-gray-600 dark:text-gray-400 tabular-nums">
                {formatInterval(s.seconds)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dashed border-amber-500/60" />
          W {thresholds.replica_write_lag_seconds.warn}s
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dashed border-orange-500/60" />
          A {thresholds.replica_write_lag_seconds.alert}s
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dashed border-red-500/60" />
          C {thresholds.replica_write_lag_seconds.critical}s
        </span>
        <span className="ml-auto italic">
          {lang === 'zh' ? 'v0.1 占位：基于当前快照' : 'v0.1 placeholder: current snapshot only'}
        </span>
      </div>
    </div>
  );
}

