import clsx from 'clsx';
import type { SlotHealth } from '../types';
import { useT } from '../i18n';
import { useApp } from '../store';
import { formatInterval } from '../lib/format';
import { SeverityBadge } from './SeverityBadge';

interface Props {
  slots: SlotHealth[];
  filterName?: string;
}

export function SlotList({ slots, filterName }: Props) {
  const t = useT();
  const lang = useApp((s) => s.lang);

  const filtered = filterName
    ? slots.filter((s) => s.slot_name === filterName)
    : slots;

  if (!filtered || filtered.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic p-2 border rounded my-1 border-gray-200 dark:border-gray-800">
        {t.noData}
      </div>
    );
  }

  return (
    <div className="p-2 border rounded my-1 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="text-xs font-semibold text-gray-500 mb-1">{t.slotList.title}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
        {filtered.map((s, i) => (
          <div
            key={`${s.slot_name}-${i}`}
            className="border border-gray-200 dark:border-gray-800 rounded p-2 text-xs"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">{s.slot_name}</span>
                <span
                  className={clsx(
                    'inline-block w-2 h-2 rounded-full',
                    s.active || s.has_active_pid
                      ? 'bg-emerald-500'
                      : 'bg-gray-400'
                  )}
                  title={s.active || s.has_active_pid ? t.alive : t.dead}
                />
                <SeverityBadge severity={s.severity} lang={lang} />
              </div>
              <span className="text-[10px] text-gray-500">{s.wal_status}</span>
            </div>
            <Row label={t.slotList.col_plugin} value={s.plugin} mono />
            <Row label={t.slotList.col_type} value={s.slot_type} mono />
            <Row
              label={t.slotList.col_active}
              value={s.active || s.has_active_pid ? t.alive : t.dead}
            />
            <Row label={t.slotList.col_restart} value={s.restart_lsn} mono />
            <Row label={t.slotList.col_confirmed} value={s.confirmed_flush_lsn} mono />
            <Row label={t.slotRetained} value={s.retained_wal} mono />
            <Row label={t.slotUnconsumed} value={s.unconsumed_wal} mono />
            <Row label={t.slotList.col_inactive} value={formatInterval(s.inactive_seconds)} />
            <Row label="health_status" value={s.health_status} mono />
            {s.invalidation_reason ? (
              <Row label={t.slotList.col_invalidation} value={s.invalidation_reason} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className={clsx('text-right', mono && 'font-mono')}>{value || '-'}</span>
    </div>
  );
}
