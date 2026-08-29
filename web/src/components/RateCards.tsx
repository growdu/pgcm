
import { useEffect, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line } from 'recharts';
import { useApp, currentSnapshot } from '../store';
import { useT } from '../i18n';
import type { RateStats, Snapshot } from '../types';

const HISTORY_LEN = 5;
const SPARK_STROKE = '#6B7280'; // gray-500

interface MetricHistory {
  total_mbps: number[];
  total_tps: number[];
  stream_mbps: number[];
  spill_mbps: number[];
}

function emptyHistory(): MetricHistory {
  return { total_mbps: [], total_tps: [], stream_mbps: [], spill_mbps: [] };
}

function pushSeries(arr: number[], v: number, max: number): number[] {
  return arr.length >= max ? [...arr.slice(1), v] : [...arr, v];
}

export function RateCards() {
  const t = useT();
  const snap = useApp(currentSnapshot);

  const historyRef = useRef<MetricHistory>(emptyHistory());
  const lastSnapRef = useRef<Snapshot | null>(null);
  const [bump, setBump] = useState(0); // force re-render when history grows

  // Push each new snapshot into the rolling 5-bucket history.
  useEffect(() => {
    if (!snap || !snap.logical) return;
    if (lastSnapRef.current === snap) return;
    lastSnapRef.current = snap;
    const r = snap.logical.rates;
    const h = historyRef.current;
    h.total_mbps = pushSeries(h.total_mbps, r.total_mbps, HISTORY_LEN);
    h.total_tps = pushSeries(h.total_tps, r.total_tps, HISTORY_LEN);
    h.stream_mbps = pushSeries(h.stream_mbps, r.stream_mbps, HISTORY_LEN);
    h.spill_mbps = pushSeries(h.spill_mbps, r.spill_mbps, HISTORY_LEN);
    setBump((n) => n + 1);
  }, [snap]);

  const logical = snap?.logical;
  if (!logical) {
    return (
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold mb-3">{t.rate.title}</h2>
        <div className="text-sm text-gray-500">{t.noData}</div>
      </section>
    );
  }

  const rates: RateStats = logical.rates;
  const hist = historyRef.current;
  // touch bump so React re-renders after history updates
  void bump;

  const totalDen = rates.total_mbps > 0 ? rates.total_mbps : 1;
  const streamPct = (rates.stream_mbps / totalDen) * 100;
  const spillPct = (rates.spill_mbps / totalDen) * 100;

  const deltaText = (arr: number[], cur: number): string => {
    if (arr.length < 2) return '—';
    const prev = arr[arr.length - 2];
    if (prev <= 0) return '—';
    const d = ((cur - prev) / prev) * 100;
    return `${d >= 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(0)}%`;
  };

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <h2 className="text-sm font-semibold mb-3">{t.rate.title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <RateCard
          label={t.rate.total}
          unit={t.rateMbps}
          value={rates.total_mbps}
          hist={hist.total_mbps}
          decimals={2}
          accent="text-emerald-600 dark:text-emerald-400"
          secondary={deltaText(hist.total_mbps, rates.total_mbps)}
        />
        <RateCard
          label={t.rate.totalTps}
          unit={t.rateTps}
          value={rates.total_tps}
          hist={hist.total_tps}
          decimals={0}
          accent="text-emerald-600 dark:text-emerald-400"
          secondary={deltaText(hist.total_tps, rates.total_tps)}
        />
        <RateCard
          label={t.rate.stream}
          unit={t.rateMbps}
          value={rates.stream_mbps}
          hist={hist.stream_mbps}
          decimals={2}
          accent="text-sky-600 dark:text-sky-400"
          secondary={`${streamPct.toFixed(0)}% ${t.rate.pct}`}
        />
        <RateCard
          label={t.rate.spill}
          unit={t.rateMbps}
          value={rates.spill_mbps}
          hist={hist.spill_mbps}
          decimals={2}
          accent="text-pink-600 dark:text-pink-400"
          secondary={`${spillPct.toFixed(0)}% ${t.rate.pct}`}
        />
      </div>
    </section>
  );
}

function formatNumber(n: number, decimals: number): string {
  if (!n || n < 0) return '0';
  if (n < 1 && n > 0) return n.toFixed(Math.max(decimals, 2));
  if (n < 100) return n.toFixed(decimals);
  return n.toFixed(0);
}

function RateCard({
  label,
  unit,
  value,
  hist,
  decimals,
  accent,
  secondary,
}: {
  label: string;
  unit: string;
  value: number;
  hist: number[];
  decimals: number;
  accent: string;
  secondary: string;
}) {
  const data =
    hist.length > 0
      ? hist.map((v, i) => ({ i, v }))
      : [{ i: 0, v: value }];

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className={`text-2xl font-semibold tabular-nums ${accent}`}>
          {formatNumber(value, decimals)}
        </div>
        <div className="text-xs text-gray-400">{unit}</div>
      </div>
      <div className="flex items-center justify-between mt-1">
        <div className="text-[10px] text-gray-500">{secondary}</div>
        <div className="w-20 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
            >
              <Line
                type="monotone"
                dataKey="v"
                dot={false}
                strokeWidth={1.5}
                stroke={SPARK_STROKE}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
