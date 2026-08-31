import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import clsx from 'clsx';
import {
  X,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  ChevronDown,
  Database,
  Check,
  AlertCircle,
} from 'lucide-react';
import { useApp, type NodeConfig } from '../store';
import { connect, type ConnectInput } from '../api/client';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../types';
import { useT } from '../i18n';

// ---------- constants ----------

type Role = NodeConfig['role'];
type Sslmode = NodeConfig['sslmode'];
type Level = 'warn' | 'alert' | 'critical';
type Unit = 'bytes' | 'count' | 'percent' | 'seconds';

const ROLE_KEYS: Role[] = ['publisher', 'subscriber', 'primary', 'replica', 'standalone'];
const SSLMODE_KEYS: Sslmode[] = ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'];
const REFRESH_KEYS = [1, 2, 5, 10, 30] as const;
const LEVELS: Level[] = ['warn', 'alert', 'critical'];
const MB = 1024 * 1024;

type ThresholdKey = keyof Thresholds;
const THRESHOLD_KEYS: ThresholdKey[] = [
  'total_lag_bytes',
  'slot_wal_retention',
  'apply_error_count_5m',
  'conflict_count_5m',
  'spill_pct',
  'worker_last_recv_age',
  'replica_write_lag_seconds',
  'replica_replay_lag_seconds',
];

const THRESHOLD_UNITS: Record<ThresholdKey, Unit> = {
  total_lag_bytes: 'bytes',
  slot_wal_retention: 'bytes',
  apply_error_count_5m: 'count',
  conflict_count_5m: 'count',
  spill_pct: 'percent',
  worker_last_recv_age: 'seconds',
  replica_write_lag_seconds: 'seconds',
  replica_replay_lag_seconds: 'seconds',
};

// Maps each threshold key to its existing i18n label key (defined in i18n/index.ts).
const THRESHOLD_LABEL_KEY: Record<ThresholdKey, string> = {
  total_lag_bytes: 'threshold_total_lag',
  slot_wal_retention: 'threshold_slot_wal_retention',
  apply_error_count_5m: 'threshold_apply_error_count_5m',
  conflict_count_5m: 'threshold_conflict_count_5m',
  spill_pct: 'threshold_spill_pct',
  worker_last_recv_age: 'threshold_worker_last_recv_age',
  replica_write_lag_seconds: 'threshold_replica_write_lag_seconds',
  replica_replay_lag_seconds: 'threshold_replica_replay_lag_seconds',
};

const emptyNode = (id: string): Omit<NodeConfig, 'password'> => ({
  id,
  name: '',
  role: 'standalone',
  host: 'localhost',
  port: 5432,
  dbname: 'postgres',
  user: 'postgres',
  sslmode: 'disable',
});

const genId = (): string =>
  `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ---------- drawer ----------

interface Props {
  open: boolean;
  onClose: () => void;
}

interface EditState {
  mode: 'add' | 'edit';
  node: Omit<NodeConfig, 'password'>;
}

interface CardTest {
  id: string;
  ok: boolean;
  msg: string;
}

export function SettingsDrawer({ open, onClose }: Props) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const theme = useApp((s) => s.theme);
  const refreshInterval = useApp((s) => s.refreshInterval);
  const thresholds = useApp((s) => s.thresholds);
  const nodes = useApp((s) => s.nodes);
  const currentNodeId = useApp((s) => s.currentNodeId);
  const setLang = useApp((s) => s.setLang);
  const setTheme = useApp((s) => s.setTheme);
  const setRefresh = useApp((s) => s.setRefresh);
  const setThresholds = useApp((s) => s.setThresholds);
  const saveNode = useApp((s) => s.saveNode);
  const removeNode = useApp((s) => s.removeNode);

  const [openSection, setOpenSection] = useState<Record<string, boolean>>({
    nodes: true,
    refresh: false,
    thresholds: false,
    theme: false,
    lang: false,
  });
  const [edit, setEdit] = useState<EditState | null>(null);
  const [editBanner, setEditBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [cardTest, setCardTest] = useState<CardTest | null>(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (edit) setEdit(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, edit, onClose]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const toggleSection = (key: string) =>
    setOpenSection((s) => ({ ...s, [key]: !s[key] }));

  const onAddNode = () => {
    setEdit({ mode: 'add', node: emptyNode(genId()) });
    setEditBanner(null);
  };

  const onEditNode = (n: Omit<NodeConfig, 'password'>) => {
    setEdit({ mode: 'edit', node: { ...n } });
    setEditBanner(null);
  };

  const onDeleteNode = (id: string) => {
    if (!confirm(t.settings.confirmDelete)) return;
    removeNode(id);
  };

  const onTestCard = async (n: Omit<NodeConfig, 'password'>) => {
    setCardTest({ id: n.id, ok: false, msg: '…' });
    try {
      const r = await connect({
        id: n.id,
        name: n.name,
        role: n.role,
        host: n.host,
        port: n.port,
        dbname: n.dbname,
        user: n.user,
        password: '',
        sslmode: n.sslmode,
      });
      setCardTest({
        id: n.id,
        ok: r.ok,
        msg: r.ok ? t.settings.testSuccess : r.error || t.settings.testFailed,
      });
    } catch (e) {
      setCardTest({
        id: n.id,
        ok: false,
        msg: e instanceof Error ? e.message : String(e),
      });
    }
    window.setTimeout(() => setCardTest((cur) => (cur && cur.id === n.id ? null : cur)), 4000);
  };

  // For byte thresholds, the user types MB; we store as bytes.
  const setThresholdField = (key: ThresholdKey, level: Level, input: number) => {
    const unit = THRESHOLD_UNITS[key];
    const stored = unit === 'bytes' ? Math.max(0, Math.round(input * MB)) : Math.max(0, input);
    setThresholds({
      ...thresholds,
      [key]: { ...thresholds[key], [level]: stored },
    });
  };

  const getThresholdInputValue = (key: ThresholdKey, level: Level): number => {
    const unit = THRESHOLD_UNITS[key];
    const v = thresholds[key][level];
    return unit === 'bytes' ? Math.round(v / MB) : v;
  };

  const restoreDefaults = () => setThresholds(DEFAULT_THRESHOLDS);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 bottom-0 w-[480px] max-w-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 z-50 overflow-y-auto"
        role="dialog"
        aria-label={t.settings.title}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h2 className="text-lg font-semibold">{t.settings.title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          {/* Section 1: Nodes */}
          <Section
            title={t.settings.sections.nodes}
            open={openSection.nodes}
            onToggle={() => toggleSection('nodes')}
            right={
              <button
                onClick={onAddNode}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.settings.addNode}
              </button>
            }
          >
            {nodes.length === 0 ? (
              <p className="text-xs text-gray-500 px-1 py-2">{t.noData}</p>
            ) : (
              <ul className="space-y-2">
                {nodes.map((n) => {
                  const test = cardTest && cardTest.id === n.id ? cardTest : null;
                  return (
                    <li
                      key={n.id}
                      className={clsx(
                        'rounded border p-3',
                        n.id === currentNodeId
                          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800'
                          : 'border-gray-200 dark:border-gray-800'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Database className="w-4 h-4 text-blue-500 shrink-0" />
                            <span className="truncate" title={n.name}>{n.name}</span>
                            <span className="shrink-0 text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                              {t.settings.roles[n.role]}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500 truncate" title={`${n.user}@${n.host}:${n.port}/${n.dbname}`}>
                            {n.user}@{n.host}:{n.port}/{n.dbname}
                          </div>
                          {test && (
                            <div
                              className={clsx(
                                'mt-2 text-[11px] flex items-center gap-1',
                                test.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                              )}
                            >
                              {test.ok ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                              <span className="truncate">{test.msg}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <IconBtn title={t.settings.editNode} onClick={() => onEditNode(n)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn title={t.settings.testConnect} onClick={() => { void onTestCard(n); }}>
                            <Check className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn title={t.settings.deleteNode} onClick={() => onDeleteNode(n.id)} danger>
                            <Trash2 className="w-3.5 h-3.5" />
                          </IconBtn>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Section 2: Refresh interval */}
          <Section
            title={t.settings.sections.refresh}
            open={openSection.refresh}
            onToggle={() => toggleSection('refresh')}
          >
            <div className="flex flex-wrap gap-2">
              {REFRESH_KEYS.map((s) => (
                <label
                  key={s}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 cursor-pointer text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <input
                    type="radio"
                    name="refresh"
 value={s}
                    checked={refreshInterval === s}
                    onChange={() => setRefresh(s)}
                    className="accent-blue-500"
                  />
                  <span>{s}s</span>
                </label>
              ))}
            </div>
          </Section>

          {/* Section 3: Thresholds */}
          <Section
            title={t.settings.sections.thresholds}
            open={openSection.thresholds}
            onToggle={() => toggleSection('thresholds')}
            right={
              <button
                onClick={restoreDefaults}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t.settings.restoreDefaults}
              </button>
            }
          >
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_64px_64px_64px_56px] gap-1.5 text-[10px] uppercase tracking-wide text-gray-500 px-1">
                <div></div>
                <div>WARN</div>
                <div>ALERT</div>
                <div>CRIT</div>
                <div>UNIT</div>
              </div>
              {THRESHOLD_KEYS.map((k) => {
                const unit = THRESHOLD_UNITS[k];
                const labelKey = THRESHOLD_LABEL_KEY[k];
                const label = ((t as unknown as Record<string, unknown>)[labelKey] as string) ?? k;
                return (
                  <div
                    key={k}
                    className="grid grid-cols-[1fr_64px_64px_64px_56px] gap-1.5 items-center"
                  >
                    <div className="text-xs truncate" title={label}>{label}</div>
                    {LEVELS.map((lv) => (
                      <input
                        key={lv}
                        type="number"
                        min={0}
                        step={unit === 'bytes' || unit === 'percent' ? 1 : 1}
                        value={getThresholdInputValue(k, lv)}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setThresholdField(k, lv, Number.isFinite(n) ? n : 0);
                        }}
                        className="w-full px-1.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
                      />
                    ))}
                    <div className="text-[11px] text-gray-500">{t.settings.units[unit]}</div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Section 4: Theme */}
          <Section
            title={t.settings.sections.theme}
            open={openSection.theme}
            onToggle={() => toggleSection('theme')}
          >
            <div className="flex gap-2">
              {(['light', 'dark'] as const).map((th) => (
                <label
                  key={th}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 cursor-pointer text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <input
                    type="radio"
                    name="theme"
                    checked={theme === th}
                    onChange={() => setTheme(th)}
                    className="accent-blue-500"
                  />
                  <span>{th === 'light' ? t.light : t.dark}</span>
                </label>
              ))}
            </div>
          </Section>

          {/* Section 5: Language */}
          <Section
            title={t.settings.sections.lang}
            open={openSection.lang}
            onToggle={() => toggleSection('lang')}
          >
            <div className="flex gap-2">
              {(['zh', 'en'] as const).map((l) => (
                <label
                  key={l}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 cursor-pointer text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <input
                    type="radio"
                    name="lang"
                    checked={lang === l}
                    onChange={() => setLang(l)}
                    className="accent-blue-500"
                  />
                  <span>{l === 'zh' ? '中文' : 'English'}</span>
                </label>
              ))}
            </div>
          </Section>
        </div>
      </aside>

      {/* DSN Edit Dialog */}
      {edit && (
        <EditDialog
          state={edit}
          lang={lang}
          onClose={() => setEdit(null)}
          onSave={(node) => {
            saveNode(node);
            setEdit(null);
          }}
          onTest={async (input) => {
            setEditBusy(true);
            setEditBanner(null);
            try {
              const r = await connect(input);
              if (r.ok) {
                setEditBanner({ kind: 'ok', text: t.settings.testSuccess });
              } else {
                setEditBanner({ kind: 'err', text: r.error || t.settings.testFailed });
              }
              return r.ok;
            } catch (e) {
              setEditBanner({
                kind: 'err',
                text: e instanceof Error ? e.message : String(e),
              });
              return false;
            } finally {
              setEditBusy(false);
            }
          }}
          busy={editBusy}
          banner={editBanner}
        />
      )}
    </>
  );
}

// ---------- helpers ----------

function Section({
  title,
  open,
  onToggle,
  right,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-800 pb-3 mb-3">
      <div className="flex items-center justify-between gap-2 py-2">
        <button
          onClick={onToggle}
          className="inline-flex items-center gap-2 text-sm font-medium hover:text-blue-500"
        >
          <ChevronDown
            className={clsx('w-4 h-4 transition-transform', open ? '' : '-rotate-90')}
          />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="pt-1">{children}</div>}
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        'p-1.5 rounded border',
        danger
          ? 'border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30'
          : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
      )}
    >
      {children}
    </button>
  );
}

// ---------- edit dialog ----------

interface EditDialogProps {
  state: EditState;
  lang: 'zh' | 'en';
  onClose: () => void;
  onSave: (node: Omit<NodeConfig, 'password'>) => void;
  onTest: (input: ConnectInput) => Promise<boolean>;
  busy: boolean;
  banner: { kind: 'ok' | 'err'; text: string } | null;
}

function EditDialog({ state, lang, onClose, onSave, onTest, busy, banner }: EditDialogProps) {
  const t = useT();
  const [form, setForm] = useState<Omit<NodeConfig, 'password'>>(state.node);
  const [password, setPassword] = useState('');
  const [validation, setValidation] = useState<string>('');

  const setField = <K extends keyof Omit<NodeConfig, 'password'>>(
    key: K,
    value: Omit<NodeConfig, 'password'>[K]
  ) => {
    setForm((s) => ({ ...s, [key]: value }));
  };

  const isEditing = state.mode === 'edit';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setValidation('name');
      return;
    }
    if (!form.host.trim() || !form.dbname.trim() || !form.user.trim()) {
      setValidation('connection');
      return;
    }
    if (!isEditing && !password) {
      setValidation('password');
      return;
    }
    setValidation('');
    onSave(form);
  };

  const handleTest = async () => {
    if (!form.host.trim() || !form.dbname.trim() || !form.user.trim()) {
      setValidation('connection');
      return;
    }
    setValidation('');
    await onTest({
      id: form.id,
      name: form.name || 'unnamed',
      role: form.role,
      host: form.host,
      port: form.port,
      dbname: form.dbname,
      user: form.user,
      password,
      sslmode: form.sslmode,
    });
  };

  const passwordPlaceholder = isEditing ? (lang === 'zh' ? '已保存' : 'saved') : '';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <form
        onSubmit={submit}
        className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            {isEditing ? t.settings.editNode : t.settings.addNode}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {banner && (
          <div
            className={clsx(
              'mb-3 p-2 rounded text-xs flex items-center gap-2',
              banner.kind === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800'
            )}
          >
            {banner.kind === 'ok' ? (
              <Check className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t.settings.name} value={form.name} onChange={(v) => setField('name', v)} />
            <SelectField
              label={t.settings.role}
              value={form.role}
              onChange={(v) => setField('role', v as Role)}
              options={ROLE_KEYS.map((r) => ({ value: r, label: t.settings.roles[r] }))}
            />
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Field label={t.host} value={form.host} onChange={(v) => setField('host', v)} />
            <Field
              label={t.port}
              value={form.port}
              type="number"
              onChange={(v) => setField('port', parseInt(v, 10) || 5432)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t.dbname} value={form.dbname} onChange={(v) => setField('dbname', v)} />
            <Field label={t.user} value={form.user} onChange={(v) => setField('user', v)} />
          </div>

          <Field
            label={t.password}
            value={password}
            type="password"
            placeholder={passwordPlaceholder}
            required={!isEditing}
            onChange={setPassword}
          />

          <SelectField
            label={t.sslmode}
            value={form.sslmode}
            onChange={(v) => setField('sslmode', v as Sslmode)}
            options={SSLMODE_KEYS.map((s) => ({ value: s, label: t.settings.sslmodes[s] }))}
          />

          {validation && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {validation === 'password'
                ? (lang === 'zh' ? '请输入密码' : 'Password is required')
                : validation === 'name'
                ? (lang === 'zh' ? '请输入名称' : 'Name is required')
                : (lang === 'zh' ? '请填写连接信息' : 'Connection fields are required')}
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              void handleTest();
            }}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm disabled:opacity-50"
          >
            {busy ? t.testing : t.settings.testConnect}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
            >
              {t.settings.cancel}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 rounded bg-blue-500 hover:bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              {t.settings.save}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoComplete="off"
      />
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
