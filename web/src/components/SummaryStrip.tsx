import { useApp, currentSnapshot } from '../store';
import { useT } from '../i18n';
import { formatBytes, severityColor } from '../lib/format';

export function SummaryStrip() {
  const t = useT();
  const snap = useApp(currentSnapshot);

  if (!snap) return null;

  let maxLag = 0;
  let worstSeverity: string = 'ok';
  const subCount = snap.logical?.subscriptions.length ?? 0;
  const repCount = snap.physical?.replicas.length ?? 0;

  if (snap.logical) {
    for (const s of snap.logical.subscriptions) {
      if (s.total_lag > maxLag) maxLag = s.total_lag;
      if (severityRank(s.severity) > severityRank(worstSeverity)) worstSeverity = s.severity;
    }
  }
  if (snap.physical) {
    for (const r of snap.physical.replicas) {
      if (severityRank(r.severity) > severityRank(worstSeverity)) worstSeverity = r.severity;
    }
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
      <Card label={t.summaryStrip.totalLag} value={formatBytes(maxLag)} severity={maxLag > 1024 ** 3 ? 'alert' : maxLag > 100 * 1024 ** 2 ? 'warn' : 'ok'} />
      <Card label={t.summaryStrip.subs} value={subCount} />
      <Card label={t.summaryStrip.reps} value={repCount} />
      <Card label={t.summaryStrip.severity} value={worstSeverity} severity={worstSeverity} />
    </div>
  );
}

function Card({ label, value, severity }: { label: string; value: string | number; severity?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${severity ? severityColor(severity) : ''}`}>
        {value}
      </div>
    </div>
  );
}

function severityRank(s: string): number {
  return ['ok', 'warn', 'alert', 'critical'].indexOf(s);
}
