export function formatBytes(b: number): string {
  if (!b || b < 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatBytesRate(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

export function formatInterval(seconds: number): string {
  if (!seconds || seconds < 0) return '-';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

export function formatRate(n: number, unit: string): string {
  if (!n || n < 0) return `0 ${unit}`;
  if (n < 1) return `${n.toFixed(2)} ${unit}`;
  if (n < 100) return `${n.toFixed(2)} ${unit}`;
  return `${n.toFixed(0)} ${unit}`;
}

export function ago(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  return `${Math.floor(diff)}s 前`;
}

export function severityColor(s: string): string {
  switch (s) {
    case 'critical':
      return 'text-severity-critical';
    case 'alert':
      return 'text-severity-alert';
    case 'warn':
      return 'text-severity-warn';
    case 'ok':
      return 'text-severity-ok';
    default:
      return 'text-severity-unknown';
  }
}

export function severityBg(s: string): string {
  switch (s) {
    case 'critical':
      return 'bg-red-950/30 border-red-800';
    case 'alert':
      return 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800';
    case 'warn':
      return 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800';
    default:
      return 'border-gray-200 dark:border-gray-800';
  }
}
