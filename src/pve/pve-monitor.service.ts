import { Injectable, OnModuleDestroy, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PveClient } from './pve-client.service';
import {
  PveGuest,
  PveGuestType,
  PveHistoryPoint,
  PveNode,
  PveOverview,
  PveStorage,
  PveTimeframe,
} from './pve.types';

interface PveNodeListItem { node: string }
interface PveNodeApiStatus {
  cpu?: unknown;
  cpuinfo?: { cores?: unknown; cpus?: unknown };
  memory?: { used?: unknown; total?: unknown };
  rootfs?: { used?: unknown; total?: unknown };
  loadavg?: unknown;
  uptime?: unknown;
}
interface PveGuestApiResource {
  vmid?: unknown;
  node?: unknown;
  name?: unknown;
  type?: unknown;
  status?: unknown;
  cpu?: unknown;
  mem?: unknown;
  maxmem?: unknown;
  disk?: unknown;
  maxdisk?: unknown;
  netin?: unknown;
  netout?: unknown;
  uptime?: unknown;
}
interface PveStorageApiStatus {
  storage?: unknown;
  type?: unknown;
  status?: unknown;
  used?: unknown;
  total?: unknown;
  avail?: unknown;
}

const TIMEFRAMES: PveTimeframe[] = ['hour', 'day', 'week', 'month', 'year'];
const EMPTY_OVERVIEW = (connection: PveOverview['connection']): PveOverview => ({
  connection,
  checkedAt: null,
  error: null,
  nodes: [],
  guests: [],
  storage: [],
});

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentage(value: unknown): number | null {
  const number = numeric(value);
  return number === null ? null : Math.round(number * 1000) / 10;
}

function usage(used: number | null, total: number | null): number | null {
  return used === null || total === null || total <= 0 ? null : Math.round((used / total) * 1000) / 10;
}

@Injectable()
export class PveMonitorService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private collecting: Promise<void> | undefined;
  private manualRefresh: Promise<PveOverview> | undefined;
  private storageCheckedAt = 0;
  private readonly storageByNode = new Map<string, PveStorage[]>();
  private readonly pollIntervalMs: number;
  private snapshot: PveOverview;

  constructor(private readonly pve: PveClient, config: ConfigService) {
    const interval = Number(config.get<string>('PVE_POLL_INTERVAL_MS'));
    this.pollIntervalMs = Number.isInteger(interval) && interval >= 1000 && interval <= 60000 ? interval : 60000;
    this.snapshot = EMPTY_OVERVIEW(pve.isConfigured ? 'connecting' : 'not_configured');
  }

  onModuleInit(): void {
    if (!this.pve.isConfigured) return;
    void this.collect();
    this.timer = setInterval(() => void this.collect(), this.pollIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  overview(): PveOverview {
    return this.snapshot;
  }

  refreshNow(): Promise<PveOverview> {
    if (this.manualRefresh) return this.manualRefresh;
    const activeCollection = this.collecting;
    const refresh = (async () => {
      if (activeCollection) await activeCollection;
      else await this.collect(true);
      return this.snapshot;
    })().finally(() => {
      this.manualRefresh = undefined;
    });
    this.manualRefresh = refresh;
    return refresh;
  }

  async nodeHistory(node: string, timeframe: string): Promise<PveHistoryPoint[]> {
    this.validateNode(node);
    const selectedTimeframe = this.validateTimeframe(timeframe);
    const rows = await this.pve.get<Record<string, unknown>[]>(
      `/nodes/${encodeURIComponent(node)}/rrddata`,
      { timeframe: selectedTimeframe },
    );
    return rows.map((row) => this.historyPoint(row));
  }

  async guestHistory(type: string, node: string, vmid: number, timeframe: string): Promise<PveHistoryPoint[]> {
    this.validateNode(node);
    this.validateVmid(vmid);
    const guestType = this.validateGuestType(type);
    const selectedTimeframe = this.validateTimeframe(timeframe);
    const rows = await this.pve.get<Record<string, unknown>[]>(
      `/nodes/${encodeURIComponent(node)}/${guestType}/${vmid}/rrddata`,
      { timeframe: selectedTimeframe },
    );
    return rows.map((row) => this.historyPoint(row));
  }

  async guestDetails(type: string, node: string, vmid: number): Promise<Record<string, unknown>> {
    this.validateNode(node);
    this.validateVmid(vmid);
    const guestType = this.validateGuestType(type);
    const row = await this.pve.get<Record<string, unknown>>(
      `/nodes/${encodeURIComponent(node)}/${guestType}/${vmid}/status/current`,
    );
    const memory = row.mem && typeof row.mem === 'object' ? row.mem as Record<string, unknown> : row;
    const disk = row.disk && typeof row.disk === 'object' ? row.disk as Record<string, unknown> : row;
    const memoryUsed = numeric(memory.used ?? row.mem);
    const memoryTotal = numeric(memory.total ?? row.maxmem);
    const diskUsed = numeric(disk.used ?? row.disk);
    const diskTotal = numeric(disk.total ?? row.maxdisk);
    return {
      vmid,
      node,
      type: guestType,
      status: String(row.status || 'unknown'),
      cpu: percentage(row.cpu),
      memory: { used: memoryUsed, total: memoryTotal, usage: usage(memoryUsed, memoryTotal) },
      disk: { used: diskUsed, total: diskTotal, usage: usage(diskUsed, diskTotal) },
      uptime: numeric(row.uptime),
    };
  }

  private collect(forceStorage = false): Promise<void> {
    if (!this.pve.isConfigured) return Promise.resolve();
    if (this.collecting) return this.collecting;

    const collection = this.collectSnapshot(forceStorage).finally(() => {
      this.collecting = undefined;
    });
    this.collecting = collection;
    return collection;
  }

  private async collectSnapshot(forceStorage: boolean): Promise<void> {
    try {
      const nodes = await this.pve.get<PveNodeListItem[]>('/nodes');
      const guestsPromise = this.pve.get<PveGuestApiResource[]>('/cluster/resources', { type: 'vm' })
        .catch(() => null);
      const refreshStorage = forceStorage || Date.now() - this.storageCheckedAt >= 120000;
      const nodeResults = await Promise.all(nodes.map((item) => this.collectNode(item.node, refreshStorage)));
      const guestRows = await guestsPromise;
      const guests = guestRows ? guestRows.flatMap((row) => this.mapGuest(row)) : this.snapshot.guests;
      const onlineCount = nodeResults.filter((node) => node.status === 'online').length;
      const connection = !nodeResults.length || onlineCount === 0
        ? 'offline'
        : onlineCount === nodeResults.length && guestRows
          ? 'online'
          : 'partial';
      this.snapshot = {
        connection,
        checkedAt: new Date().toISOString(),
        error: connection === 'online' ? null : '部分或全部 PVE 数据暂不可用',
        nodes: nodeResults,
        guests,
        storage: nodeResults.flatMap((node) => this.storageByNode.get(node.name) || []),
      };
      if (refreshStorage) this.storageCheckedAt = Date.now();
    } catch {
      this.snapshot = {
        ...this.snapshot,
        connection: 'offline',
        error: '无法连接 PVE API',
        nodes: this.snapshot.nodes.map((node) => ({ ...node, status: 'unavailable' })),
      };
    }
  }

  private async collectNode(node: string, refreshStorage: boolean): Promise<PveNode> {
    const [statusResult, storageResult] = await Promise.allSettled([
      this.pve.get<PveNodeApiStatus>(`/nodes/${encodeURIComponent(node)}/status`),
      refreshStorage
        ? this.pve.get<PveStorageApiStatus[]>(`/nodes/${encodeURIComponent(node)}/storage`)
        : Promise.resolve(null),
    ]);

    if (storageResult.status === 'fulfilled' && storageResult.value) {
      this.storageByNode.set(node, storageResult.value.map((row) => this.mapStorage(node, row)));
    }

    if (statusResult.status === 'rejected') {
      return {
        name: node,
        status: 'unavailable',
        cpu: { usage: null, cores: null },
        memory: { used: null, total: null, usage: null },
        disk: { used: null, total: null, usage: null },
        load: [],
        uptime: null,
      };
    }

    const status = statusResult.value;
    const memoryUsed = numeric(status.memory?.used);
    const memoryTotal = numeric(status.memory?.total);
    const diskUsed = numeric(status.rootfs?.used);
    const diskTotal = numeric(status.rootfs?.total);
    const load = Array.isArray(status.loadavg)
      ? status.loadavg.map(numeric).filter((value): value is number => value !== null)
      : [];

    return {
      name: node,
      status: 'online',
      cpu: { usage: percentage(status.cpu), cores: numeric(status.cpuinfo?.cpus ?? status.cpuinfo?.cores) },
      memory: { used: memoryUsed, total: memoryTotal, usage: usage(memoryUsed, memoryTotal) },
      disk: { used: diskUsed, total: diskTotal, usage: usage(diskUsed, diskTotal) },
      load,
      uptime: numeric(status.uptime),
    };
  }

  private mapGuest(row: PveGuestApiResource): PveGuest[] {
    if ((row.type !== 'qemu' && row.type !== 'lxc') || numeric(row.vmid) === null) return [];
    const memoryUsed = numeric(row.mem);
    const memoryTotal = numeric(row.maxmem);
    const diskUsed = numeric(row.disk);
    const diskTotal = numeric(row.maxdisk);
    return [{
      vmid: numeric(row.vmid) as number,
      node: String(row.node || ''),
      name: String(row.name || row.vmid),
      type: row.type,
      status: String(row.status || 'unknown'),
      cpu: percentage(row.cpu),
      memory: { used: memoryUsed, total: memoryTotal, usage: usage(memoryUsed, memoryTotal) },
      disk: { used: diskUsed, total: diskTotal, usage: usage(diskUsed, diskTotal) },
      network: { in: numeric(row.netin), out: numeric(row.netout) },
      uptime: numeric(row.uptime),
    }];
  }

  private mapStorage(node: string, row: PveStorageApiStatus): PveStorage {
    const used = numeric(row.used);
    const total = numeric(row.total);
    return {
      node,
      name: String(row.storage || ''),
      type: row.type == null ? null : String(row.type),
      status: row.status == null ? null : String(row.status),
      used,
      total,
      available: numeric(row.avail),
      usage: usage(used, total),
    };
  }

  private historyPoint(row: Record<string, unknown>): PveHistoryPoint {
    const memoryUsed = numeric(row.mem ?? row.memused);
    const memoryTotal = numeric(row.maxmem ?? row.memtotal);
    const diskUsed = numeric(row.disk ?? row.rootused);
    const diskTotal = numeric(row.maxdisk ?? row.roottotal);
    const timestamp = numeric(row.time);
    return {
      time: timestamp === null ? null : new Date(timestamp * 1000).toISOString(),
      cpu: percentage(row.cpu),
      memory: { used: memoryUsed, total: memoryTotal, usage: usage(memoryUsed, memoryTotal) },
      disk: { used: diskUsed, total: diskTotal, usage: usage(diskUsed, diskTotal) },
      load: numeric(Array.isArray(row.loadavg) ? row.loadavg[0] : row.loadavg),
      network: { in: numeric(row.netin), out: numeric(row.netout) },
    };
  }

  private validateNode(node: string): void {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(node)) throw new BadRequestException('PVE 节点名称无效');
  }

  private validateGuestType(type: string): PveGuestType {
    if (type !== 'qemu' && type !== 'lxc') throw new BadRequestException('VM 类型必须是 qemu 或 lxc');
    return type;
  }

  private validateVmid(vmid: number): void {
    if (!Number.isSafeInteger(vmid) || vmid <= 0) throw new BadRequestException('VMID 无效');
  }

  private validateTimeframe(timeframe: string): PveTimeframe {
    if (!TIMEFRAMES.includes(timeframe as PveTimeframe)) {
      throw new BadRequestException('timeframe 必须为 hour、day、week、month 或 year');
    }
    return timeframe as PveTimeframe;
  }
}
