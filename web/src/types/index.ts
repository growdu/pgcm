export type ClusterKind = 'logical' | 'physical' | 'hybrid' | 'standalone';
export type Severity = 'ok' | 'warn' | 'alert' | 'critical';

export interface ConnectResponse {
  ok: boolean;
  node_id?: string;
  pg_version?: string;
  cluster_kind?: ClusterKind;
  error?: string;
}

export interface SubscriptionSummary {
  subname: string;
  subenabled: boolean;
  slot_name: string;
  slot_wal_status: string;
  slot_wal_retention_bytes: number;
  seg_pub_to_flush: number;
  seg_flush_to_received: number;
  seg_received_to_applied: number;
  total_lag: number;
  apply_worker_pid: number | null;
  worker_type: string | null;
  spill_pct: number;
  total_mbps: number;
  apply_error_count: number;
  conflict_counts: Record<string, number>;
  last_recv_age_seconds: number;
  severity: Severity;
}

export interface PhysicalReplicaStat {
  application_name: string;
  client_addr: string;
  state: string;
  sync_state: string;
  sent_lsn: string;
  write_lsn: string;
  flush_lsn: string;
  replay_lsn: string;
  write_lag_seconds: number;
  flush_lag_seconds: number;
  replay_lag_seconds: number;
  backend_start_ago: string;
  reply_time_ago: string;
  severity: Severity;
}

export interface SlotHealth {
  slot_name: string;
  plugin: string;
  slot_type: string;
  wal_status: string;
  active: boolean;
  has_active_pid: boolean;
  restart_lsn: string;
  confirmed_flush_lsn: string;
  retained_wal: string;
  unconsumed_wal: string;
  inactive_seconds: number;
  invalidation_reason?: string;
  health_status: string;
  severity: Severity;
}

export interface WorkerStat {
  subname: string;
  pid: number;
  worker_type: string;
  leader_pid?: number;
  relid?: string;
  received_lsn: string;
  latest_end_lsn: string;
  in_memory_lag: string;
  last_send_age_seconds: number;
  last_recv_age_seconds: number;
  last_apply_age_seconds: number;
  alive: boolean;
  backend_state?: string;
  wait_event?: string;
  severity: Severity;
}

export interface ErrorStat {
  subname: string;
  apply_error_count: number;
  sync_error_count: number;
  confl_insert_exists: number;
  confl_update_exists: number;
  confl_update_missing: number;
  confl_delete_missing: number;
  confl_multiple_unique_conflicts: number;
}

export interface SpillStat {
  slot_name: string;
  spill_bytes: number;
  spill_count: number;
  spill_txns: number;
  stream_bytes: number;
  stream_count: number;
  stream_txns: number;
  total_bytes: number;
  total_txns: number;
  spill_pct: number;
  stream_to_spill_ratio: number;
  avg_spill_size: string;
  window_seconds: number;
}

export interface RateStats {
  total_mbps: number;
  total_tps: number;
  spill_mbps: number;
  stream_mbps: number;
}

export interface LogicalPanel {
  subscriptions: SubscriptionSummary[];
  workers: WorkerStat[];
  errors: ErrorStat[];
  spill_stats: SpillStat[];
  rates: RateStats;
}

export interface PhysicalPanel {
  replicas: PhysicalReplicaStat[];
}

export interface Snapshot {
  taken_at: string;
  node_id: string;
  node_name: string;
  pg_version: string;
  logical?: LogicalPanel;
  physical?: PhysicalPanel;
  slots: SlotHealth[];
}

export interface TickMessage {
  type: 'tick';
  ts: string;
  payload: Snapshot | Snapshot[];
}

export interface Thresholds {
  total_lag_bytes: { warn: number; alert: number; critical: number };
  slot_wal_retention: { warn: number; alert: number; critical: number };
  apply_error_count_5m: { warn: number; alert: number; critical: number };
  conflict_count_5m: { warn: number; alert: number; critical: number };
  spill_pct: { warn: number; alert: number; critical: number };
  worker_last_recv_age: { warn: number; alert: number; critical: number };
  replica_write_lag_seconds: { warn: number; alert: number; critical: number };
  replica_replay_lag_seconds: { warn: number; alert: number; critical: number };
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  total_lag_bytes: { warn: 100 * 1024 * 1024, alert: 1024 ** 3, critical: 10 * 1024 ** 3 },
  slot_wal_retention: { warn: 10 * 1024 ** 3, alert: 50 * 1024 ** 3, critical: 100 * 1024 ** 3 },
  apply_error_count_5m: { warn: 5, alert: 50, critical: 200 },
  conflict_count_5m: { warn: 10, alert: 100, critical: 500 },
  spill_pct: { warn: 20, alert: 50, critical: 80 },
  worker_last_recv_age: { warn: 300, alert: 1800, critical: 7200 },
  replica_write_lag_seconds: { warn: 30, alert: 300, critical: 900 },
  replica_replay_lag_seconds: { warn: 30, alert: 300, critical: 900 },
};
