import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { GhomePlayer, GhomeWorldCreation, GhomeSaveArchive } from '../database/entities/ghome-player.entity';
import { GhomeWorld, GhomeCommandReceipt } from '../database/entities/ghome-world.entity';
import WorldModel, { validateSnapshot, objectCells, DEFINITIONS, TILE, MAP_COLUMNS, MAP_ROWS } from './core/build/WorldModel.js';
import { getTimeState, WEATHER } from './core/environment.js';
import catalog from './core/catalog.json';
import defaultIsland from './core/default-island.json';
import { Command, Creature, Position, WorldMap, WorldRuntime } from './types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const GROWTH_MS = 300000;
const STAGE_MS = GROWTH_MS / 3;
type Loaded = { row: GhomeWorld; map: WorldMap; runtime: WorldRuntime; movedAt: number; movementBudget: number; dirty: boolean };
function fail(message: string): never { throw new BadRequestException(message); }
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('参数必须是对象');
  return value as Record<string, any>;
}
function only(value: Record<string, any>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) fail('含有不支持的参数');
}
export function validateAppearance(value: unknown): Record<string, string> {
  const fields = object(value); only(fields, Object.keys(catalog.characterOptions));
  for (const [key, choices] of Object.entries(catalog.characterOptions)) {
    if (!choices.some((choice) => choice.value === fields[key])) fail('角色外观选项无效');
  }
  return clone(fields);
}
export function cropStage(plantedAt: number, now: number): number {
  return Math.min(3, Math.max(0, Math.floor((now - plantedAt) / STAGE_MS)));
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

@Injectable()
export class GhomeWorldService {
  readonly updates = new EventEmitter();
  now = () => Date.now();
  private tail: Promise<unknown> = Promise.resolve();
  private models = new WeakMap<WorldMap, WorldModel>();
  private loaded = new Map<string, Loaded>();
  private initializing = new Set<string>();
  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }
  private async load(ownerId: string): Promise<Loaded> {
    let world = this.loaded.get(ownerId);
    if (!world) {
      const row = await this.db.getRepository(GhomeWorld).findOneBy({ ownerId });
      if (!row) throw new NotFoundException('世界尚未创建');
      if (row.schemaVersion !== 1) throw new ConflictException('世界存档版本不支持');
      world = { row, map: validateSnapshot(JSON.parse(row.mapJson)), runtime: JSON.parse(row.runtimeJson), movedAt: this.now(), movementBudget: 16, dirty: false };
      this.loaded.set(ownerId, world);
    }
    return world;
  }
  private time(world: Loaded): number {
    const now = Math.max(this.now(), world.runtime.lastObservedAt);
    world.runtime.lastObservedAt = now;
    return now;
  }
  private runtimeView(world: Loaded) {
    const now = this.time(world); const runtime = world.runtime;
    const environment = getTimeState(runtime.anchorAt, runtime.anchorMinute, now, runtime.seasonOverride);
    // A date's weather is deterministic across reloads and server restarts.
    let hash = 2166136261;
    for (const char of `${world.map.generator?.seed || world.row.id}:${environment.dayNumber}:${environment.seasonIndex}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const weights = [{ clear: 60, rain: 35, thunder: 5 }, { clear: 65, rain: 15, thunder: 20 }, { clear: 80, rain: 15, thunder: 5 }, { clear: 60, snow: 40 }];
    let roll = (hash >>> 0) % 100; let weatherKind = 'clear';
    for (const [kind, weight] of Object.entries(weights[environment.seasonIndex])) {
      if (roll < weight) { weatherKind = kind; break; } roll -= weight;
    }
    weatherKind = runtime.weatherOverride ?? weatherKind;
    return { worldId: world.row.id, mapRevision: world.row.mapRevision, serverNow: now,
      environment: { ...environment, weatherKind, weatherLabel: WEATHER[weatherKind as keyof typeof WEATHER].label,
        seasonOverride: runtime.seasonOverride, weatherOverride: runtime.weatherOverride },
      player: clone(runtime.player), appearance: clone(runtime.appearance), creatures: clone(runtime.creatures),
      seeds: runtime.seeds, vegetables: runtime.vegetables,
      ...(runtime.identity ? { identity: clone(runtime.identity) } : {}), ...(runtime.tutorial ? { tutorial: clone(runtime.tutorial) } : {}),
      crops: runtime.crops.map(crop => ({ ...crop, stage: cropStage(crop.plantedAt, now) })) };
  }
  private snapshot(world: Loaded) {
    const session = this.runtimeView(world); const map = clone(world.map);
    map.crops.forEach(spot => { spot.stage = session.crops.find(crop => crop.column === spot.column && crop.row === spot.row)?.stage ?? -1; });
    return { worldId: world.row.id, mapRevision: world.row.mapRevision, map, session };
  }
  read(ownerId: string) { return this.serial(async () => this.snapshot(await this.load(ownerId))); }
  state(ownerId: string) { return this.serial(async () => this.runtimeView(await this.load(ownerId))); }

  private name(value: unknown, label: string) {
    if (typeof value !== 'string') fail(`${label}不能为空`);
    const text = value.trim();
    if (Array.from(text).length < 1 || Array.from(text).length > 12 || /[\u0000-\u001f\u007f<>]/u.test(text)) fail(`${label}请使用 1–12 个文字，不含特殊符号`);
    return text;
  }
  async entry(ownerId: string) {
    const result = await this.serial(async () => {
      let player = await this.db.getRepository(GhomePlayer).findOneBy({ ownerId });
      const creation = await this.db.getRepository(GhomeWorldCreation).findOneBy({ ownerId });
      const existing = await this.db.getRepository(GhomeWorld).findOneBy({ ownerId });
      // Existing islands acquire an identity without modifying any saved world data.
      if (!player && existing) {
        const runtime: WorldRuntime = JSON.parse(existing.runtimeJson);
        player = await this.db.getRepository(GhomePlayer).save({ ownerId, id: randomUUID(), nickname: '岛屿主人',
          appearanceJson: JSON.stringify(runtime.appearance), createdAt: this.now() });
      }
      return { player: player ? { id: player.id, nickname: player.nickname, appearance: JSON.parse(player.appearanceJson) } : null,
        world: creation || (existing ? { worldId: existing.id, name: '芽芽岛', templateId: 'existing', templateVersion: 1,
          status: 'READY' as const, completed: 3, error: '' } : null) };
    });
    if (result.world?.status === 'INITIALIZING') this.resumeCreation(ownerId);
    return result;
  }
  createPlayer(ownerId: string, value: unknown) {
    return this.serial(async () => {
      const input = object(value); only(input, ['nickname', 'appearance']);
      const nickname = this.name(input.nickname, '角色昵称'); const appearance = validateAppearance(input.appearance);
      const repository = this.db.getRepository(GhomePlayer);
      const existing = await repository.findOneBy({ ownerId });
      if (existing) return { id: existing.id, nickname: existing.nickname, appearance: JSON.parse(existing.appearanceJson) };
      const player = await repository.save({ ownerId, id: randomUUID(), nickname, appearanceJson: JSON.stringify(appearance), createdAt: this.now() });
      return { id: player.id, nickname, appearance };
    });
  }
  updatePlayer(ownerId: string, value: unknown) {
    return this.serial(async () => {
      const input = object(value); only(input, ['nickname', 'appearance']);
      const nickname = this.name(input.nickname, '角色昵称'); const appearance = validateAppearance(input.appearance);
      const repository = this.db.getRepository(GhomePlayer); const player = await repository.findOneBy({ ownerId });
      if (!player) throw new NotFoundException('角色尚未创建');
      if (await this.db.getRepository(GhomeWorldCreation).findOneBy({ ownerId }) || await this.db.getRepository(GhomeWorld).findOneBy({ ownerId }))
        throw new ConflictException('小岛已开始创建，不能返回修改初始角色');
      await repository.update(ownerId, { nickname, appearanceJson: JSON.stringify(appearance) });
      return { id: player.id, nickname, appearance };
    });
  }
  async saves(ownerId: string) {
    await this.entry(ownerId);
    return this.serial(async () => {
      const player = await this.db.getRepository(GhomePlayer).findOneBy({ ownerId });
      const creation = await this.db.getRepository(GhomeWorldCreation).findOneBy({ ownerId });
      const world = await this.db.getRepository(GhomeWorld).findOneBy({ ownerId });
      const runtime = world ? (await this.load(ownerId)).runtime : null;
      const archive = await this.db.getRepository(GhomeSaveArchive).findOne({ where: { ownerId }, order: { deletedAt: 'DESC' } });
      return { saves: player ? [{ id: player.id, nickname: player.nickname, appearance: JSON.parse(player.appearanceJson),
        createdAt: player.createdAt, updatedAt: runtime?.lastObservedAt ?? creation?.createdAt ?? player.createdAt,
        world: creation ? { worldId: creation.worldId, name: creation.name, status: creation.status }
          : world ? { worldId: world.id, name: runtime?.identity?.worldName || '芽芽岛', status: 'READY' } : null }] : [],
        deleted: !player && archive ? { id: archive.id, nickname: archive.nickname, deletedAt: archive.deletedAt } : null };
    });
  }
  deleteSave(ownerId: string, playerId: string) {
    return this.serial(async () => {
      const player = await this.db.getRepository(GhomePlayer).findOneBy({ ownerId, id: playerId });
      if (!player) throw new NotFoundException('该角色存档不存在，请刷新列表');
      const creation = await this.db.getRepository(GhomeWorldCreation).findOneBy({ ownerId });
      if (creation?.status === 'INITIALIZING' || this.initializing.has(ownerId)) throw new ConflictException('小岛正在初始化，请完成后再删除');
      const row = await this.db.getRepository(GhomeWorld).findOneBy({ ownerId });
      if (row) {
        const world = await this.load(ownerId); this.time(world);
        row.runtimeJson = JSON.stringify(world.runtime);
      }
      const receipts = row ? await this.db.getRepository(GhomeCommandReceipt).findBy({ worldId: row.id }) : [];
      const archive = { id: randomUUID(), ownerId, nickname: player.nickname, deletedAt: this.now(),
        snapshotJson: JSON.stringify({ player, creation, world: row, receipts }) };
      await this.db.transaction(async manager => {
        await manager.getRepository(GhomeSaveArchive).insert(archive);
        if (row) { await manager.getRepository(GhomeCommandReceipt).delete({ worldId: row.id }); await manager.getRepository(GhomeWorld).delete({ ownerId }); }
        await manager.getRepository(GhomeWorldCreation).delete({ ownerId });
        await manager.getRepository(GhomePlayer).delete({ ownerId });
      });
      this.loaded.delete(ownerId); this.updates.emit(`${ownerId}:deleted`);
      return { archiveId: archive.id };
    });
  }
  restoreSave(ownerId: string, archiveId: string) {
    return this.serial(async () => {
      const archive = await this.db.getRepository(GhomeSaveArchive).findOneBy({ ownerId, id: archiveId });
      if (!archive) throw new NotFoundException('可恢复的存档不存在');
      if (await this.db.getRepository(GhomePlayer).findOneBy({ ownerId }) || await this.db.getRepository(GhomeWorld).findOneBy({ ownerId }))
        throw new ConflictException('已有角色存档，无法覆盖恢复');
      const saved = JSON.parse(archive.snapshotJson);
      await this.db.transaction(async manager => {
        await manager.getRepository(GhomePlayer).insert(saved.player);
        if (saved.creation) await manager.getRepository(GhomeWorldCreation).insert(saved.creation);
        if (saved.world) await manager.getRepository(GhomeWorld).insert(saved.world);
        if (saved.receipts.length) await manager.getRepository(GhomeCommandReceipt).insert(saved.receipts);
        await manager.getRepository(GhomeSaveArchive).delete({ ownerId, id: archiveId });
      });
      this.loaded.delete(ownerId);
      return { ok: true };
    });
  }

  async createWorld(ownerId: string, value: unknown) {
    const creation = await this.serial(async () => {
      const input = object(value); only(input, ['name', 'templateId']);
      const name = this.name(input.name, '小岛名称');
      if (input.templateId !== 'sprout_island') fail('该岛屿风格尚未开放');
      if (!await this.db.getRepository(GhomePlayer).findOneBy({ ownerId })) fail('请先创建角色');
      const repository = this.db.getRepository(GhomeWorldCreation);
      const existing = await repository.findOneBy({ ownerId });
      if (existing) return existing;
      if (await this.db.getRepository(GhomeWorld).findOneBy({ ownerId })) throw new ConflictException('已有世界，请返回入口加载存档');
      return repository.save({ ownerId, worldId: randomUUID(), name, templateId: 'sprout_island', templateVersion: 1,
        status: 'INITIALIZING' as const, completed: 0, error: '', createdAt: this.now() });
    });
    if (creation.status === 'INITIALIZING') this.resumeCreation(ownerId);
    return creation;
  }
  async retryCreation(ownerId: string) {
    await this.serial(async () => {
      const repository = this.db.getRepository(GhomeWorldCreation);
      const row = await repository.findOneBy({ ownerId });
      if (!row) throw new NotFoundException('尚未创建小岛');
      if (row.status === 'FAILED') await repository.update(ownerId, { status: 'INITIALIZING', error: '' });
    });
    return this.entry(ownerId);
  }
  private resumeCreation(ownerId: string) {
    if (this.initializing.has(ownerId)) return;
    this.initializing.add(ownerId);
    // Each completed task is persisted; reading the entry resumes after process shutdown.
    setImmediate(() => { void this.initializeCreation(ownerId).finally(() => this.initializing.delete(ownerId)); });
  }
  private async initializeCreation(ownerId: string) {
    const repository = this.db.getRepository(GhomeWorldCreation);
    try {
      const creation = await repository.findOneBy({ ownerId });
      const player = await this.db.getRepository(GhomePlayer).findOneBy({ ownerId });
      if (!creation || creation.status !== 'INITIALIZING' || !player) return;
      if (creation.templateId !== 'sprout_island' || creation.templateVersion !== 1) fail('地图模板版本不支持');
      validateSnapshot(clone(defaultIsland)); validateAppearance(JSON.parse(player.appearanceJson));
      await repository.update(ownerId, { completed: Math.max(creation.completed, 1) });
      await this.bootstrap(ownerId, { appearance: JSON.parse(player.appearanceJson) }, { creation, player });
      await repository.update(ownerId, { completed: 2 });
      await this.read(ownerId);
      await repository.update(ownerId, { completed: 3, status: 'READY', error: '' });
    } catch (error) {
      try { await repository.update(ownerId, { status: 'FAILED', error: error instanceof HttpException ? error.message : '小岛初始化暂时失败，请重试' }); }
      catch { /* The persisted INITIALIZING record can resume when storage recovers. */ }
    }
  }

  bootstrap(ownerId: string, value: unknown, journey?: { creation: GhomeWorldCreation; player: GhomePlayer }) {
    return this.serial(async () => {
      const existing = await this.db.getRepository(GhomeWorld).findOneBy({ ownerId });
      if (existing) return this.snapshot(await this.load(ownerId));
      const input = object(value); only(input, ['snapshot', 'appearance']);
      let map: WorldMap;
      try { map = validateSnapshot(input.snapshot ?? clone(defaultIsland)); }
      catch (error) { throw new BadRequestException(`本地地图迁移失败：${(error as Error).message}`); }
      if (Buffer.byteLength(JSON.stringify(map)) > 2 * 1024 * 1024) fail('地图超过 2 MiB');
      const now = this.now(); const spawn = map.spawn || { column: 22, row: 19 };
      const runtime: WorldRuntime = { anchorAt: now, anchorMinute: 480, lastObservedAt: now, seasonOverride: null, weatherOverride: null,
        player: { x: (spawn.column + .5) * TILE, y: (spawn.row + .3) * TILE, facing: 'down' },
        appearance: validateAppearance(input.appearance ?? catalog.defaultCharacter), seeds: 20, vegetables: 0, creatures: [],
        crops: map.crops.filter(crop => crop.stage >= 0).map(crop => ({ column: crop.column, row: crop.row,
          plantedAt: now - crop.stage * STAGE_MS, matureAt: now + GROWTH_MS - crop.stage * STAGE_MS })) };
      map.crops.forEach(crop => { crop.stage = -1; });
      const row = Object.assign(new GhomeWorld(), { id: journey?.creation.worldId ?? randomUUID(), ownerId, schemaVersion: 1, mapRevision: 1, mapJson: JSON.stringify(map), runtimeJson: JSON.stringify(runtime) });
      const world: Loaded = { row, map, runtime, movedAt: now, movementBudget: 16, dirty: false };
      this.relocate(world);
      if (journey) {
        runtime.identity = { playerId: journey.player.id, nickname: journey.player.nickname, worldName: journey.creation.name };
        const gift = [{ x: runtime.player.x + 32, y: runtime.player.y }, { x: runtime.player.x - 32, y: runtime.player.y },
          { x: runtime.player.x, y: runtime.player.y + 32 }, { x: runtime.player.x, y: runtime.player.y - 32 }]
          .find(position => this.safe(map, { ...position, facing: 'down' })) || runtime.player;
        runtime.tutorial = { step: 'arrival', start: clone(runtime.player), gift: { ...gift, facing: 'down' } };
      }
      row.runtimeJson = JSON.stringify(runtime);
      await this.db.getRepository(GhomeWorld).insert(row);
      this.loaded.set(ownerId, world);
      return this.snapshot(world);
    });
  }

  private safe(map: WorldMap, position: Position, creatureId?: string): boolean {
    const definition = creatureId && catalog.creatures.find(creature => creature.id === creatureId);
    const bounds = definition ? { x: position.x + (definition.body.offsetX - definition.frameWidth / 2) * definition.scale,
      y: position.y + (definition.body.offsetY - definition.frameHeight / 2) * definition.scale,
      width: definition.body.width * definition.scale, height: definition.body.height * definition.scale, movementMode: definition.movementMode }
      : { x: position.x - 4, y: position.y, width: 8, height: 6, movementMode: 'walk' };
    let model = this.models.get(map);
    if (!model) { model = new WorldModel(map); this.models.set(map, model); }
    return model.safeActors([bounds]);
  }
  private relocate(world: Loaded) {
    for (const actor of [world.runtime.player, ...world.runtime.creatures]) {
      const id = 'id' in actor ? actor.id as string : undefined;
      if (this.safe(world.map, actor, id)) continue;
      const candidates = [];
      for (let row = 0; row < MAP_ROWS; row++) for (let column = 0; column < MAP_COLUMNS; column++) candidates.push({ x: (column + .5) * TILE, y: (row + .3) * TILE });
      candidates.sort((a, b) => Math.hypot(a.x - actor.x, a.y - actor.y) - Math.hypot(b.x - actor.x, b.y - actor.y));
      const safe = candidates.find(position => this.safe(world.map, { ...position, facing: actor.facing }, id));
      if (!safe) fail('地图没有合法角色位置');
      Object.assign(actor, safe);
    }
  }
  private position(value: unknown): Position {
    const input = object(value); only(input, ['x', 'y', 'facing']);
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || !['up', 'down', 'left', 'right', 'side'].includes(input.facing)) fail('位置或朝向无效');
    return input as Position;
  }
  move(ownerId: string, value: unknown) {
    return this.serial(async () => {
      const world = await this.load(ownerId); const position = this.position(value); const now = this.time(world);
      const allowance = Math.min(74, world.movementBudget + 58 * Math.max(0, now - world.movedAt) / 1000);
      const distance = Math.hypot(position.x - world.runtime.player.x, position.y - world.runtime.player.y);
      if (!this.safe(world.map, position) || distance > allowance) fail('移动距离过大或位置不可通行');
      const steps = Math.max(1, Math.ceil(distance / 4));
      for (let step = 1; step <= steps; step++) {
        const between = { ...position, x: world.runtime.player.x + (position.x - world.runtime.player.x) * step / steps,
          y: world.runtime.player.y + (position.y - world.runtime.player.y) * step / steps };
        if (!this.safe(world.map, between)) fail('移动路径不可通行');
      }
      world.movementBudget = allowance - distance;
      world.runtime.player = clone(position); world.movedAt = now; world.dirty = true;
      if (world.runtime.tutorial?.step === 'move' && Math.hypot(position.x - world.runtime.tutorial.start.x, position.y - world.runtime.tutorial.start.y) >= 16) {
        world.runtime.tutorial.step = 'gift'; await this.persist(world);
      }
      this.updates.emit(ownerId);
      return this.runtimeView(world);
    });
  }
  checkpoint(ownerId: string, value: unknown) {
    return this.serial(async () => {
      const world = await this.load(ownerId); const input = object(value); only(input, ['creatures']);
      if (!Array.isArray(input.creatures) || input.creatures.length > catalog.creatures.length) fail('生物检查点无效');
      const seen = new Set<string>(); const creatures: Creature[] = [];
      for (const entry of input.creatures) {
        const fields = object(entry); only(fields, ['id', 'type', 'x', 'y', 'facing']);
        const definition = catalog.creatures.find(creature => creature.id === fields.id && creature.type === fields.type);
        if (!definition || seen.has(fields.id)) fail('未知或重复的生物'); seen.add(fields.id);
        const position = this.position({ x: fields.x, y: fields.y, facing: fields.facing });
        if (!this.safe(world.map, position, fields.id)) continue;
        creatures.push({ ...position, id: fields.id, type: fields.type });
      }
      const updated = new Map(world.runtime.creatures.map(creature => [creature.id, creature]));
      creatures.forEach(creature => updated.set(creature.id, creature));
      world.runtime.creatures = [...updated.values()]; world.dirty = true;
      await this.persist(world);
      this.updates.emit(ownerId);
      return this.runtimeView(world);
    });
  }
  private async persist(world: Loaded) {
    this.time(world);
    await this.db.getRepository(GhomeWorld).update(world.row.id, { runtimeJson: JSON.stringify(world.runtime) });
    world.dirty = false;
  }
  flush(ownerId?: string) {
    return this.serial(async () => {
      for (const [id, world] of this.loaded) if ((!ownerId || ownerId === id) && world.dirty) await this.persist(world);
    });
  }
  release(ownerId: string) {
    return this.serial(async () => {
      const world = this.loaded.get(ownerId);
      if (world?.dirty) await this.persist(world);
      this.loaded.delete(ownerId);
    });
  }

  command(ownerId: string, value: unknown) {
    return this.serial(async () => {
      const input = object(value); only(input, ['commandId', 'type', 'payload']);
      if (typeof input.commandId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.commandId)) fail('操作编号无效');
      if (!['plant', 'harvest', 'appearance', 'environment', 'map', 'arrival', 'starter-gift'].includes(input.type)) fail('未知操作');
      const command = input as Command; const payload = object(input.payload ?? {});
      const current = await this.load(ownerId);
      const digest = createHash('sha256').update(canonical(command)).digest('hex');
      const receipt = await this.db.getRepository(GhomeCommandReceipt).findOneBy({ worldId: current.row.id, commandId: command.commandId });
      if (receipt) {
        if (receipt.digest !== digest) throw new ConflictException('操作编号已被用于不同内容');
        const previous = JSON.parse(receipt.resultJson);
        if (!previous.ok) throw new HttpException(previous.message, previous.status);
        return previous;
      }
      try {
      const next = clone(current); const now = this.time(next);
      if (command.type === 'plant' || command.type === 'harvest') {
        only(payload, ['column', 'row']);
        if (!Number.isInteger(payload.column) || !Number.isInteger(payload.row)) fail('农田坐标无效');
        const spot = next.map.crops.find(crop => crop.column === payload.column && crop.row === payload.row);
        if (!spot) fail('这里不是可种植农田');
        const model = new WorldModel(next.map);
        const bottomInset = model.surfaceBase(spot.column, spot.row + 1) === 'soil' ? 0 : 3;
        const target = { x: (spot.column + .5) * TILE, y: (spot.row + .52) * TILE - bottomInset - 3 };
        if (Math.hypot(target.x - next.runtime.player.x, target.y - next.runtime.player.y) >= 34) fail('请靠近农田');
        const crop = next.runtime.crops.find(entry => entry.column === spot.column && entry.row === spot.row);
        if (command.type === 'plant') {
          if (crop) fail('这块农田已有作物'); if (next.runtime.seeds < 1) fail('种子不足');
          next.runtime.seeds--; next.runtime.crops.push({ column: spot.column, row: spot.row, plantedAt: now, matureAt: now + GROWTH_MS });
        } else {
          if (!crop || now < crop.matureAt) fail('作物尚未成熟');
          next.runtime.crops = next.runtime.crops.filter(entry => entry !== crop);
          next.runtime.vegetables++; next.runtime.seeds++;
        }
      } else if (command.type === 'arrival' || command.type === 'starter-gift') {
        only(payload, []);
        const tutorial = next.runtime.tutorial;
        if (!tutorial) fail('没有待完成的新手任务');
        if (command.type === 'arrival') {
          if (tutorial.step === 'arrival') tutorial.step = 'move';
        } else if (tutorial.step === 'gift') {
          if (Math.hypot(next.runtime.player.x - tutorial.gift.x, next.runtime.player.y - tutorial.gift.y) >= 34) fail('请靠近新手礼物');
          next.runtime.seeds += 5; tutorial.step = 'build';
        } else if (tutorial.step !== 'build' && tutorial.step !== 'done') fail('请先试着移动');
      } else if (command.type === 'appearance') {
        next.runtime.appearance = validateAppearance(payload);
      } else if (command.type === 'environment') {
        if (this.config.get('NODE_ENV') === 'production') fail('生产环境不能修改世界时间天气');
        only(payload, ['minute', 'seasonIndex', 'weatherKind']);
        if (payload.minute !== undefined) {
          if (!Number.isInteger(payload.minute) || payload.minute < 0 || payload.minute >= 1440) fail('时间无效');
          const elapsed = Math.max(0, now - next.runtime.anchorAt) / 1000;
          next.runtime.anchorMinute = Math.floor((next.runtime.anchorMinute + elapsed) / 1440) * 1440 + payload.minute;
          next.runtime.anchorAt = now;
        }
        if (payload.seasonIndex !== undefined) {
          if (payload.seasonIndex !== null && (!Number.isInteger(payload.seasonIndex) || payload.seasonIndex < 0 || payload.seasonIndex > 3)) fail('季节无效');
          next.runtime.seasonOverride = payload.seasonIndex;
        }
        if (payload.weatherKind !== undefined) {
          if (payload.weatherKind !== null && !Object.prototype.hasOwnProperty.call(WEATHER, payload.weatherKind)) fail('天气无效');
          next.runtime.weatherOverride = payload.weatherKind;
        }
      } else {
        only(payload, ['snapshot', 'baseMapRevision']);
        if (payload.baseMapRevision !== next.row.mapRevision) throw new ConflictException('地图已更新，请重新加载');
        const draft = clone(object(payload.snapshot));
        // Crop stages are a server projection, never an editor input.
        if (Array.isArray(draft.crops)) draft.crops = draft.crops.map((crop: any) => ({ column: crop.column, row: crop.row, stage: -1 }));
        let map: WorldMap;
        try { map = validateSnapshot(draft); } catch (error) { throw new BadRequestException((error as Error).message); }
        if (Buffer.byteLength(JSON.stringify(map)) > 2 * 1024 * 1024) fail('地图超过 2 MiB');
        for (const crop of next.runtime.crops) {
          const structures = (snapshot: WorldMap) => snapshot.objects.filter(entry => objectCells(entry)
            .some(cell => cell.column === crop.column && cell.row === crop.row)).sort((a, b) => a.id.localeCompare(b.id));
          if (!map.crops.some(spot => spot.column === crop.column && spot.row === crop.row)
            || canonical(map.cells[crop.row][crop.column]) !== canonical(next.map.cells[crop.row][crop.column])
            || canonical(structures(map)) !== canonical(structures(next.map))) fail('请先收获已有作物再改造农田');
        }
        if (next.runtime.tutorial?.step === 'build' && map.objects.some(entry =>
          !next.map.objects.some(previous => previous.id === entry.id) && ['building', 'decoration'].includes(DEFINITIONS[entry.type]?.category ?? ''))) {
          next.runtime.tutorial.step = 'done';
        }
        next.map = map; this.relocate(next); next.row.mapRevision++;
      }
      next.row.mapJson = JSON.stringify(next.map); next.row.runtimeJson = JSON.stringify(next.runtime); next.dirty = false;
      const result = { commandId: command.commandId, ok: true, session: this.runtimeView(next) };
      await this.db.transaction(async (manager: EntityManager) => {
        await manager.getRepository(GhomeWorld).save(next.row);
        if (command.type === 'appearance') await manager.getRepository(GhomePlayer).update(ownerId, { appearanceJson: JSON.stringify(next.runtime.appearance) });
        await manager.getRepository(GhomeCommandReceipt).insert({ worldId: next.row.id, commandId: command.commandId, digest, resultJson: JSON.stringify(result) });
      });
      this.loaded.set(ownerId, next); this.updates.emit(ownerId);
      return result;
      } catch (error) {
        // Business rejections are final receipts; storage faults remain retryable.
        if (error instanceof HttpException) {
          await this.db.getRepository(GhomeCommandReceipt).insert({ worldId: current.row.id, commandId: command.commandId, digest,
            resultJson: JSON.stringify({ commandId: command.commandId, ok: false, status: error.getStatus(), message: error.message }) });
        }
        throw error;
      }
    });
  }
}
