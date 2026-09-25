export type PveConnection = 'not_configured' | 'connecting' | 'online' | 'partial' | 'offline';
export type PveGuestType = 'qemu' | 'lxc';
export type PveTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface PveNode {
  name: string;
  status: 'online' | 'unavailable';
  cpu: { usage: number | null; cores: number | null };
  memory: { used: number | null; total: number | null; usage: number | null };
  disk: { used: number | null; total: number | null; usage: number | null };
  load: number[];
  uptime: number | null;
}

export interface PveGuest {
  vmid: number;
  node: string;
  name: string;
  type: PveGuestType;
  status: string;
  cpu: number | null;
  memory: { used: number | null; total: number | null; usage: number | null };
  disk: { used: number | null; total: number | null; usage: number | null };
  network: { in: number | null; out: number | null };
  uptime: number | null;
}

export interface PveStorage {
  node: string;
  name: string;
  type: string | null;
  status: string | null;
  used: number | null;
  total: number | null;
  available: number | null;
  usage: number | null;
}

export interface PveOverview {
  connection: PveConnection;
  checkedAt: string | null;
  error: string | null;
  nodes: PveNode[];
  guests: PveGuest[];
  storage: PveStorage[];
}

export interface PveHistoryPoint {
  time: string | null;
  cpu: number | null;
  memory: { used: number | null; total: number | null; usage: number | null };
  disk: { used: number | null; total: number | null; usage: number | null };
  load: number | null;
  network: { in: number | null; out: number | null };
}
