
import { useApp, currentSnapshot } from '../store';
import { useT } from '../i18n';
import { formatBytes } from '../lib/format';
import { DEFAULT_THRESHOLDS, type SubscriptionSummary } from '../types';

const BAR_HEIGHT = 'h-7';
const MIN_PX = 6; // min width so non-zero tiny segments stay visible

// Log-scale mapping: width(x) = log10(1 + x) / log10(1 + max).
// Avoids a huge segment swallowing tiny ones.
function logWidth(value: number, logMax: number): number {
  if (!logMax || logMax <= 0 || value <= 0) return 0;
  return Math.log10(1 + value) / logMax;
}

function segmentSeverity(value: number): 'warn' | 'alert' | 'critical' | null {
  const th = DEFAULT_THRESHOLDS.total_lag_bytes;
  if (value >= th.critical) return 'critical';
  if (value >= th.alert) return 'alert';
  if (value >= th.warn) return 'warn';
  return null;
}

export function LagStackBar() {
  const t = useT();
  const snap = useApp(currentSnapshot);

  const logical = snap?.logical;
  if (!logical) {
    return (
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold mb-3">{t.lagBar.title}</h2>
        <div className="text-sm text-gray-500">{t.noData}</div>
      </section>
    );
  }

  const subs = logical.subscriptions;

  if (subs.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold mb-3">{t.lagBar.title}</h2>
        <div className="text-sm text-gray-500">{t.lagBar.noData}</div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold">{t.lagBar.title}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500">
          <Legend color="bg-pink-400 dark:bg-pink-500" label={t.lagBar.pubToFlush} />
          <Legend color="bg-purple-400 dark:bg-purple-500" label={t.lagBar.flushToReceived} />
          <Legend color="bg-emerald-400 dark:bg-emerald-500" label={t.lagBar.receivedToApplied} />
          <Legend color="bg-sky-400 dark:bg-sky-500" label={t.lagBar.remaining} />
        </div>
      </div>
      <div className="space-y-1.5">
        {subs.map((s) => (
          <LagBarRow key={s.subname} sub={s} />
        ))}
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-sm ${color}`} />
      <span>{label}</span>
    </span>
  );
}

function LagBarRow({ sub }: { sub: SubscriptionSummary }) {
  const t = useT();
  const total = Math.max(0, sub.total_lag);
  const pub = Math.max(0, sub.seg_pub_to_flush);
  const flush = Math.max(0, sub.seg_flush_to_received); // v0.1 typically 0
  const recv = Math.max(0, sub.seg_received_to_applied);
  const known = pub + flush + recv;
  const remaining = Math.max(0, total - known);

  const segs = [
    {
      key: 'pubToFlush',
      label: t.lagBar.pubToFlush,
      value: pub,
      bg: 'bg-pink-400 dark:bg-pink-500',
      text: 'text-pink-50',
    },
    {
      key: 'flushToReceived',
      label: t.lagBar.flushToReceived,
      value: flush,
      bg: 'bg-purple-400 dark:bg-purple-500',
      text: 'text-purple-50',
    },
    {
      key: 'receivedToApplied',
      label: t.lagBar.receivedToApplied,
      value: recv,
      bg: 'bg-emerald-400 dark:bg-emerald-500',
      text: 'text-emerald-50',
    },
    {
      key: 'remaining',
      label: t.lagBar.remaining,
      value: remaining,
      bg: 'bg-sky-400 dark:bg-sky-500',
      text: 'text-sky-50',
    },
  ];

  const logMax = total > 0 ? Math.log10(1 + total) : 0;

  return (
    <div className="flex items-center gap-2">
      <div
        className="w-32 truncate text-xs font-medium text-gray-700 dark:text-gray-300"
        title={sub.subname}
      >
        {sub.subname}
      </div>
      <div
        className={`flex-1 ${BAR_HEIGHT} rounded overflow-hidden bg-gray-100 dark:bg-gray-800 flex`}
      >
        {total <= 0 ? (
          <div className="flex-1 flex items-center justify-center text-[10px] text-gray-400">
            0 B
          </div>
        ) : (
          segs.map((seg) => {
            const w = logWidth(seg.value, logMax);
            const sev = segmentSeverity(seg.value);
            const ringCls =
              sev === 'critical'
                ? 'ring-2 ring-inset ring-red-700'
                : sev === 'alert'
                ? 'ring-2 ring-inset ring-red-500'
                : sev === 'warn'
                ? 'ring-2 ring-inset ring-amber-500'
                : '';
            return (
              <div
                key={seg.key}
                className={`relative h-full ${seg.bg} ${ringCls} flex items-center justify-center overflow-hidden`}
                style={{
                  width: `${(w * 100).toFixed(3)}%`,
                  minWidth: seg.value > 0 ? MIN_PX : 0,
                }}
                title={`${seg.label}: ${formatBytes(seg.value)} · slot=${sub.slot_name} · total=${formatBytes(total)}`}
              >
                {w >= 0.06 && seg.value > 0 && (
                  <span className={`text-[10px] ${seg.text} font-medium px-1 truncate leading-none`}>
                    {formatBytes(seg.value)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="w-24 text-right text-xs text-gray-500 tabular-nums">
        {formatBytes(total)}
      </div>
    </div>
  );
}
