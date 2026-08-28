import { useState } from 'react';
import { Database as DatabaseIcon } from 'lucide-react';
import { useApp } from '../store';
import { connect } from '../api/client';
import { useT } from '../i18n';

export function WelcomeScreen() {
  const t = useT();
  const setConn = useApp((s) => s.setConn);
  const setMeta = useApp((s) => s.setMeta);

  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(5432);
  const [dbname, setDbname] = useState('postgres');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('');
  const [sslmode, setSslmode] = useState<'disable' | 'require' | 'prefer' | 'verify-ca' | 'verify-full'>('disable');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setConn('connecting');
    try {
      const r = await connect({
        name: 'primary',
        role: 'publisher',
        host,
        port,
        dbname,
        user,
        password,
        sslmode,
      });
      if (!r.ok) {
        setErr(r.error || t.errConnect);
        setConn('error', r.error || '');
        return;
      }
      setConn('connected');
      setMeta({ nodeId: r.node_id!, pgVersion: r.pg_version!, clusterKind: r.cluster_kind! });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setConn('error', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-2">
          <DatabaseIcon className="w-8 h-8 text-blue-500" />
          <h1 className="text-2xl font-semibold">{t.title}</h1>
        </div>
        <p className="text-sm text-gray-500 mb-1">{t.welcome}</p>
        <p className="text-xs text-gray-400 mb-6">{t.welcomeHint}</p>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label={t.host} value={host} onChange={setHost} className="col-span-2" />
            <Field label={t.port} value={port} onChange={(v) => setPort(parseInt(v) || 5432)} type="number" />
          </div>
          <Field label={t.dbname} value={dbname} onChange={setDbname} />
          <Field label={t.user} value={user} onChange={setUser} />
          <Field label={t.password} value={password} onChange={setPassword} type="password" />
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t.sslmode}</label>
            <select
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
              value={sslmode}
              onChange={(e) => setSslmode(e.target.value as typeof sslmode)}
            >
              <option value="disable">disable</option>
              <option value="prefer">prefer</option>
              <option value="require">require</option>
              <option value="verify-ca">verify-ca</option>
              <option value="verify-full">verify-full</option>
            </select>
          </div>
        </div>

        {err && (
          <div className="mt-4 p-3 rounded bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm">{err}</div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full py-2.5 rounded bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white font-medium transition"
        >
          {busy ? t.testing : t.connect}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  className = '',
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoComplete="off"
      />
    </div>
  );
}
