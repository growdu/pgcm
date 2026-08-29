import { ChevronDown, Database } from 'lucide-react';
import { useApp } from '../store';
import { connect } from '../api/client';
import { useT } from '../i18n';

export function NodeSwitcher() {
  const t = useT();
  const nodes = useApp((s) => s.nodes);
  const currentNodeId = useApp((s) => s.currentNodeId);
  const setMeta = useApp((s) => s.setMeta);
  const setConn = useApp((s) => s.setConn);

  const current = nodes.find((n) => n.id === currentNodeId);

  // v0.1 single-DSN mode: hide the dropdown when 0 or 1 nodes are saved.
  if (nodes.length <= 1) {
    return (
      <div className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
        <Database className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="font-medium truncate max-w-[160px]" title={current?.name}>
          {current?.name ?? t.settings.singleNode}
        </span>
      </div>
    );
  }

  const onChange = async (id: string) => {
    const target = nodes.find((n) => n.id === id);
    if (!target) return;
    setConn('connecting');
    try {
      const r = await connect({
        id: target.id,
        name: target.name,
        role: target.role,
        host: target.host,
        port: target.port,
        dbname: target.dbname,
        user: target.user,
        // Password is never persisted locally; user re-enters via the edit
        // dialog when a fresh authentication round-trip is required.
        password: '',
        sslmode: target.sslmode,
      });
      if (r.ok && r.node_id) {
        setMeta({
          nodeId: r.node_id,
          pgVersion: r.pg_version ?? '',
          clusterKind: r.cluster_kind ?? '',
        });
        setConn('connected');
      } else {
        setConn('error', r.error ?? '');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConn('error', msg);
    }
  };

  return (
    <div className="relative inline-flex items-center">
      <Database className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
      <select
        value={currentNodeId ?? ''}
        onChange={(e) => {
          void onChange(e.target.value);
        }}
        className="appearance-none pl-7 pr-7 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label={t.settings.currentNode}
      >
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
    </div>
  );
}
