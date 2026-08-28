import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Snapshot, Thresholds } from '../types';
import { DEFAULT_THRESHOLDS } from '../types';

export type Lang = 'zh' | 'en';
export type Theme = 'light' | 'dark';
export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface NodeConfig {
  id: string;
  name: string;
  role: 'publisher' | 'subscriber' | 'primary' | 'replica' | 'standalone';
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
  sslmode: 'disable' | 'require' | 'prefer' | 'verify-ca' | 'verify-full';
  pgVersion?: string;
  clusterKind?: string;
}

interface AppState {
  // 连接
  connState: ConnState;
  connError: string;
  currentNodeId: string | null;
  pgVersion: string;
  clusterKind: string;

  // 快照
  snapshots: Record<string, Snapshot>;
  lastTickAt: string | null;

  // 设置
  lang: Lang;
  theme: Theme;
  refreshInterval: 1 | 2 | 5 | 10 | 30;
  thresholds: Thresholds;
  nodes: Omit<NodeConfig, 'password'>[];

  // actions
  setConn: (s: ConnState, err?: string) => void;
  setSnapshot: (nodeId: string, snap: Snapshot) => void;
  setMeta: (meta: { nodeId: string; pgVersion: string; clusterKind: string }) => void;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  setRefresh: (n: 1 | 2 | 5 | 10 | 30) => void;
  setThresholds: (t: Thresholds) => void;
  saveNode: (n: Omit<NodeConfig, 'password'>) => void;
  removeNode: (id: string) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      connState: 'disconnected',
      connError: '',
      currentNodeId: null,
      pgVersion: '',
      clusterKind: '',
      snapshots: {},
      lastTickAt: null,
      lang: 'zh',
      theme: 'light',
      refreshInterval: 5,
      thresholds: DEFAULT_THRESHOLDS,
      nodes: [],
      setConn: (s, err = '') => set({ connState: s, connError: err }),
      setSnapshot: (nodeId, snap) =>
        set((state) => ({
          snapshots: { ...state.snapshots, [nodeId]: snap },
          lastTickAt: new Date().toISOString(),
        })),
      setMeta: (m) => set({ ...m }),
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => {
        set({ theme });
        if (typeof document !== 'undefined') {
          document.documentElement.classList.toggle('dark', theme === 'dark');
        }
      },
      setRefresh: (refreshInterval) => set({ refreshInterval }),
      setThresholds: (thresholds) => set({ thresholds }),
      saveNode: (n) =>
        set((state) => ({
          nodes: state.nodes.find((x) => x.id === n.id)
            ? state.nodes.map((x) => (x.id === n.id ? n : x))
            : [...state.nodes, n],
        })),
      removeNode: (id) =>
        set((state) => ({ nodes: state.nodes.filter((x) => x.id !== id) })),
    }),
    {
      name: 'pgcm-settings',
      partialize: (s) => ({
        lang: s.lang,
        theme: s.theme,
        refreshInterval: s.refreshInterval,
        thresholds: s.thresholds,
        nodes: s.nodes,
      }),
    }
  )
);

export function currentSnapshot(state: AppState): Snapshot | null {
  if (!state.currentNodeId) return null;
  return state.snapshots[state.currentNodeId] ?? null;
}
