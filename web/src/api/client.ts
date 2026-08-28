import type { ConnectResponse } from '../types';

export interface ConnectInput {
  id?: string;
  name: string;
  role: string;
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
  sslmode: string;
}

export async function connect(input: ConnectInput): Promise<ConnectResponse> {
  const r = await fetch('/api/v1/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, id: input.id || '' }),
  });
  const data = (await r.json()) as ConnectResponse;
  if (!r.ok) return data;
  return data;
}

export async function disconnect(nodeId: string): Promise<void> {
  await fetch('/api/v1/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: nodeId }),
  });
}

export async function snapshot(nodeId?: string): Promise<unknown[]> {
  const r = await fetch('/api/v1/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nodeId ? { node_id: nodeId } : {}),
  });
  return (await r.json()) as unknown[];
}

export async function health(): Promise<{ status: string; version: string }> {
  const r = await fetch('/healthz');
  return r.json();
}
