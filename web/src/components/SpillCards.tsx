
import { useApp, currentSnapshot } from '../store';
import { useT } from '../i18n';
import { DEFAULT_THRESHOLDS, type SpillStat } from '../types';

type Kind = 'ok' | 'warn' | 'alert' | 'critical';

function pctSeverity(pct: number): Kind {
  const th = DEFAULT_THRESHOLDS.spill_pct;
  if (pct >= th.critical) return 'critical';
  if (pct >= th.alert) return 'alert';
  if (pct >= th.warn) return 'warn';
  return 'ok';
}

function kindClass(k: Kind): string {
  switch (k) {
    case 'critical':
      return 'text-severity-critical';
    case 'alert':
      return 'text-severity-alert';
    case 'warn':
      return 'text-severity-warn';
    default:
      return 'text-severity-ok';
  }
}

function avgOf(stats: SpillStat[], pick: (s: SpillStat) => number): number {
  if (stats.length === 0) return 0;
  const sum = stats.reduce((acc, s) => acc + pick(s), 0);
  return sum / stats.length;
}

// Pick the slot whose avg spill size is the most "representative" — the slot
// with the largest spill_bytes (most-spilling workload).
function pickAvgSpillLabel(stats: SpillStat[]): string {
  if (stats.length === 0) return '—';
  let top = stats[0];
  for (const s of stats) {
    if (s.spill_bytes > top.spill_bytes) top = s;
  }
  return top.avg_spill_size || '—';
}

export function SpillCards() {
  const t = useT();
  const snap = useApp(currentSnapshot);
  const logical = snap?.logical;
  const stats = logical?.spill_stats ?? [];

  if (stats.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold mb-3">{t.spill.title}</h2>
        <div className="text-sm text-gray-500">{t.spill.noData}</div>
      </section>
    );
  }

  const avgSpillPct = avgOf(stats, (s) => s.spill_pct);
  const avgRatio = avgOf(stats, (s) => s.stream_to_spill_ratio);
  const avgWindow = avgOf(stats, (s) => s.window_seconds);
  const avgLabel = pickAvgSpillLabel(stats);

  const kind = pctSeverity(avgSpillPct);
  const spillPctCls = kindClass(kind);

  // Spec: ratio >= 10 → green (healthy), else gray (watch).
  const ratioCls =
    avgRatio >= 10
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-gray-500 dark:text-gray-400';
  const ratioSub = avgRatio >= 10 ? t.spill.ratioGood : t.spill.ratioWarn;

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <h2 className="text-sm font-semibold mb-3">{t.spill.title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          label={t.spill.spillPct}
          value={`${avgSpillPct.toFixed(1)}%`}
          color={spillPctCls}
        />
        <Card
          label={t.spill.streamRatio}
          value={avgRatio.toFixed(1)}
          color={ratioCls}
          sub={ratioSub}
        />
        <Card label={t.spill.avgSpill} value={avgLabel} />
        <Card
          label={t.spill.windowSec}
          value={`${Math.round(avgWindow)}s`}
          sub={`${stats.length} ${t.slot}`}
        />
      </div>
    </section>
  );
}

function Card({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color ?? ''}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
