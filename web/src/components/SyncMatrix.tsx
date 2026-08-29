import clsx from 'clsx';
import { useT } from '../i18n';

interface SyncMatrixCell {
  subname?: string;
  srsubstate?: string;
  state_name?: string;
  table_count?: number;
  oldest_state_lsn?: string;
}

interface Props {
  cells: SyncMatrixCell[];
  subname?: string;
}

const STATES = ['i', 'f', 'd', 's', 'c', 'r', 'w'] as const;
type StateChar = (typeof STATES)[number];

function stateStyle(k: StateChar): string {
  switch (k) {
    case 'i':
      return 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    case 'f':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'd':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
    case 's':
      return 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200';
    case 'c':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
    case 'r':
      return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300';
    default:
      return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
  }
}

export function SyncMatrix({ cells, subname }: Props) {
  const t = useT();

  if (!cells || cells.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic p-2 border rounded my-1 border-gray-200 dark:border-gray-800">
        {t.noData}
      </div>
    );
  }

  const counts: Record<StateChar, number> = { i: 0, f: 0, d: 0, s: 0, c: 0, r: 0, w: 0 };
  for (const c of cells) {
    const k = ((c.srsubstate || c.state_name || 'w').charAt(0).toLowerCase() as StateChar);
    if ((STATES as readonly string[]).includes(k)) {
      counts[k] += 1;
    } else {
      counts.w += 1;
    }
  }

  return (
    <div className="p-2 border rounded my-1 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="text-xs font-semibold text-gray-500 mb-1">
        {t.syncMatrix.title}
        {subname ? <span className="ml-1 text-gray-400">({subname})</span> : null}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {STATES.map((k) => (
              <th key={k} className="text-center py-1 px-1 font-mono">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {STATES.map((k) => (
              <td
                key={k}
                className={clsx(
                  'text-center py-1 px-1 rounded font-mono font-semibold',
                  stateStyle(k)
                )}
                title={t.syncMatrix.states[k]}
              >
                {counts[k]}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
