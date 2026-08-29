import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, currentSnapshot } from './store';
import { WSClient } from './api/ws';
import { WelcomeScreen } from './components/WelcomeScreen';
import { TopBar } from './components/TopBar';
import { NodeSwitcher } from './components/NodeSwitcher';
import { SummaryStrip } from './components/SummaryStrip';
import { LagStackBar } from './components/LagStackBar';
import { RateCards } from './components/RateCards';
import { SpillCards } from './components/SpillCards';
import { SubscriptionTable } from './components/SubscriptionTable';
import { ReplicaTable } from './components/ReplicaTable';
import { SlotList } from './components/SlotList';
import { SettingsDrawer } from './components/SettingsDrawer';
import { useT } from './i18n';

interface SyncMatrixCell {
  subname?: string;
  srsubstate?: string;
  state_name?: string;
  table_count?: number;
  oldest_state_lsn?: string;
}

// JSON shape of ws tick payload. Mirrors Go `model.Snapshot` / `TickMessage`.
function asSnapshots(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  return [payload];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function readString(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  return typeof v === 'string' ? v : '';
}

export function App() {
  const connState = useApp((s) => s.connState);
  const setSnapshot = useApp((s) => s.setSnapshot);
  const setMeta = useApp((s) => s.setMeta);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const wsRef = useRef<WSClient | null>(null);

  // ── WS lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    if (connState !== 'connected') {
      wsRef.current?.disconnect();
      wsRef.current = null;
      return;
    }
    const ws = new WSClient('/api/v1/ws');
    ws.on((msg) => {
      if (msg.type !== 'tick') return;
      const snaps = asSnapshots(msg.payload);
      for (const raw of snaps) {
        if (!isObject(raw)) continue;
        const nodeId = readString(raw, 'node_id');
        if (!nodeId) continue;
        const snap = raw as Parameters<typeof setSnapshot>[1];
        setSnapshot(nodeId, snap);
        // Sync currentNodeId from first observed tick when store is empty.
        const { currentNodeId: cur } = useApp.getState();
        if (!cur) {
          setMeta({
            nodeId,
            pgVersion: readString(raw, 'pg_version'),
            clusterKind: readString(raw, 'cluster_kind') || 'standalone',
          });
        }
      }
    });
    ws.connect();
    wsRef.current = ws;
    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [connState, setSnapshot, setMeta]);

  // ── Route: welcome vs dashboard ────────────────────────────────
  if (connState !== 'connected') {
    return <WelcomeScreen />;
  }

  return (
    <Dashboard
      settingsOpen={settingsOpen}
      onSettings={() => setSettingsOpen(true)}
      onCloseSettings={() => setSettingsOpen(false)}
    />
  );
}

interface DashboardProps {
  settingsOpen: boolean;
  onSettings: () => void;
  onCloseSettings: () => void;
}

function Dashboard({ settingsOpen, onSettings, onCloseSettings }: DashboardProps) {
  const t = useT();
  const snap = useApp(currentSnapshot);
  const thresholds = useApp((s) => s.thresholds);

  const logical = snap?.logical;
  const physical = snap?.physical;

  // Build sync_matrix for the current logical panel.
  const syncMatrix: SyncMatrixCell[] = useMemo(() => {
    const raw = (snap as unknown as { sync_matrix?: unknown })?.sync_matrix;
    const fromTop = Array.isArray(raw) ? (raw as SyncMatrixCell[]) : [];
    const fromLogical = (logical?.sync_matrix ?? []) as unknown as SyncMatrixCell[];
    return fromTop.length > 0 ? fromTop : fromLogical;
  }, [snap, logical]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <TopBar onSettings={onSettings} />

      <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center gap-3">
        <NodeSwitcher />
        <div className="text-xs text-gray-500 truncate">
          {snap?.node_name ?? snap?.node_id ?? ''}
        </div>
      </div>

      <SummaryStrip />

      <main className="px-4 pb-8 space-y-4">
        <LagStackBar />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RateCards />
          <SpillCards />
        </div>

        {logical && (
          <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <h2 className="text-sm font-semibold mb-3">{t.subTable.title}</h2>
            <SubscriptionTable
              subscriptions={logical.subscriptions ?? []}
              workers={logical.workers ?? []}
              errors={logical.errors ?? []}
              slots={snap?.slots ?? []}
              syncMatrix={syncMatrix}
              thresholds={thresholds}
            />
          </section>
        )}

        {physical && physical.replicas && physical.replicas.length > 0 && (
          <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <h2 className="text-sm font-semibold mb-3">{t.replicaTable.title}</h2>
            <ReplicaTable />
          </section>
        )}

        {snap?.slots && snap.slots.length > 0 && (
          <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <h2 className="text-sm font-semibold mb-3">{t.slotHealth}</h2>
            <SlotList slots={snap.slots} />
          </section>
        )}

        {logical && logical.subscriptions.length === 0 && physical?.replicas.length === 0 && (
          <div className="text-sm text-gray-500 italic p-6 text-center border rounded border-dashed border-gray-300 dark:border-gray-700">
            {t.noCluster}
          </div>
        )}
      </main>

      <SettingsDrawer open={settingsOpen} onClose={onCloseSettings} />
    </div>
  );
}
