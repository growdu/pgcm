import { Settings, Moon, Sun, Languages, Download, Power } from 'lucide-react';
import { useApp, currentSnapshot, type ConnState } from '../store';
import { useT } from '../i18n';
import { disconnect } from '../api/client';
import { ago } from '../lib/format';

interface Props {
  onSettings: () => void;
}

export function TopBar({ onSettings }: Props) {
  const t = useT();
  const connState = useApp((s) => s.connState);
  const connError = useApp((s) => s.connError);
  const pgVersion = useApp((s) => s.pgVersion);
  const clusterKind = useApp((s) => s.clusterKind);
  const lastTickAt = useApp((s) => s.lastTickAt);
  const theme = useApp((s) => s.theme);
  const lang = useApp((s) => s.lang);
  const setTheme = useApp((s) => s.setTheme);
  const setLang = useApp((s) => s.setLang);
  const currentNodeId = useApp((s) => s.currentNodeId);
  const setConn = useApp((s) => s.setConn);
  const snap = useApp(currentSnapshot);

  const exportJson = () => {
    if (!snap) return;
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pgcm-snapshot-${snap.taken_at}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dot = (s: ConnState) =>
    s === 'connected' ? 'bg-green-500' : s === 'connecting' ? 'bg-yellow-500 animate-pulse' : s === 'error' ? 'bg-red-500' : 'bg-gray-400';

  return (
    <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="text-lg font-semibold">pgcm</span>
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <span className={`w-2 h-2 rounded-full ${dot(connState)}`} />
          {connState === 'connected' ? (
            <span>
              PG {pgVersion} · {clusterKind}
            </span>
          ) : connState === 'error' ? (
            <span className="text-red-500" title={connError}>{t.errConnect}</span>
          ) : connState === 'connecting' ? (
            <span>…</span>
          ) : (
            <span>{t.disconnecting}</span>
          )}
          {lastTickAt && connState === 'connected' && (
            <span className="text-xs text-gray-400 ml-2">{ago(lastTickAt)}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1 text-sm"
          title={t.lang}
        >
          <Languages className="w-4 h-4" />
          {lang === 'zh' ? '中' : 'En'}
        </button>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t.theme}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button
          onClick={exportJson}
          disabled={!snap}
          className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"
          title={t.exportJson}
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={onSettings}
          className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t.settingsTitle}
        >
          <Settings className="w-4 h-4" />
        </button>
        {currentNodeId && (
          <button
            onClick={async () => {
              await disconnect(currentNodeId);
              setConn('disconnected');
            }}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-red-500"
            title={t.disconnect}
          >
            <Power className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
}
