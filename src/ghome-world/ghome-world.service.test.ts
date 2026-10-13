import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { GhomeWorld, GhomeCommandReceipt } from '../database/entities/ghome-world.entity';
import { InitAuth1710000000000 } from '../database/migrations/1710000000000-InitAuth';
import { InitGhomeWorld1710000000004 } from '../database/migrations/1710000000004-InitGhomeWorld';
import { GhomeWorldService, GROWTH_MS } from './ghome-world.service';
import WorldModel, { createInitialWorld, validateSnapshot } from './core/build/WorldModel.js';
import defaultIsland from './core/default-island.json';

async function fixture(run: (f: { db: DataSource; service: GhomeWorldService; advance: (ms: number) => void; restart: () => GhomeWorldService }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'ghome-world-'));
  const db = new DataSource({ type: 'better-sqlite3', database: join(directory, 'world.sqlite'),
    entities: [GhomeWorld, GhomeCommandReceipt], migrations: [InitAuth1710000000000, InitGhomeWorld1710000000004] });
  await db.initialize(); await db.runMigrations();
  for (const id of ['alice', 'bob']) await db.query('INSERT INTO users (id, username, passwordHash, role, isActive) VALUES (?, ?, ?, ?, ?)', [id, id, 'test-only', 'admin', 1]);
  let now = 1800000000000;
  const restart = () => { const service = new GhomeWorldService(db, new ConfigService({ NODE_ENV: 'test' })); service.now = () => now; return service; };
  try { await run({ db, service: restart(), advance: ms => { now += ms; }, restart }); }
  finally { await db.destroy(); await rm(directory, { recursive: true, force: true }); }
}
function farmMap(stage = -1) {
  const map = createInitialWorld();
  map.cells.forEach(line => line.forEach(cell => { cell.base = 'grass'; cell.road = null; delete cell.inlandWater; }));
  map.spawn = { column: 10, row: 10 }; map.cells[10][10].base = 'soil'; map.crops = [{ column: 10, row: 10, stage }];
  return map;
}
const command = (commandId: string, type: string, payload: any = { column: 10, row: 10 }) => ({ commandId, type, payload });

test('migration, unique per-account creation, fixed default layout and isolated worlds', async () => fixture(async f => {
  // Pin the complete user-supplied map, including terrain and spawn.
  assert.equal(createHash('sha256').update(JSON.stringify(defaultIsland)).digest('hex'), 'cc8251581073f6f0e7f3a557da4cf64975cc5ffd0153f36e7b5045eaa7814098');
  await assert.rejects(f.service.read('alice'), /世界尚未创建/);
  const [a, b] = await Promise.all([f.service.bootstrap('alice', {}), f.service.bootstrap('alice', { snapshot: { version: -1 } })]);
  assert.equal(a.worldId, b.worldId); assert.deepEqual(a.map, defaultIsland); assert.equal(a.session.seeds, 20);
  assert.equal(a.session.environment.time, '08:00');
  a.map.cells[0][0].base = 'grass';
  const other = await f.service.bootstrap('bob', {}); assert.notEqual(other.worldId, a.worldId);
  assert.deepEqual(other.map, defaultIsland);
  assert.deepEqual((await f.restart().read('alice')).map, defaultIsland);
  assert.equal((await f.db.getRepository(GhomeWorld).count()), 2);
}));

test('legacy terrain, buildings, crop stages and appearance migrate once; damaged data never creates a world', async () => fixture(async f => {
  await assert.rejects(f.service.bootstrap('alice', { snapshot: { version: -1 } }), /迁移失败/);
  assert.equal(await f.db.getRepository(GhomeWorld).count(), 0);
  const map = farmMap(2); map.objects.push({ id: 'home', type: 'house', column: 20, row: 20 });
  const result = await f.service.bootstrap('alice', { snapshot: map });
  assert.equal(result.map.crops[0].stage, 2); assert.deepEqual(result.map.objects, map.objects); assert.deepEqual(result.map.cells, map.cells);
  f.advance(100000); assert.equal((await f.restart().read('alice')).map.crops[0].stage, 3);
  const preserved = await f.service.bootstrap('alice', { snapshot: farmMap(-1) }); assert.equal(preserved.map.crops[0].stage, 3);
}));

test('planting, exact growth boundaries, offline restart and harvest are idempotent', async () => fixture(async f => {
  await f.service.bootstrap('alice', { snapshot: farmMap() });
  const result = await f.service.command('alice', command('plant-1', 'plant')); assert.equal(result.session.seeds, 19);
  await f.service.command('alice', command('plant-1', 'plant')); assert.equal((await f.service.state('alice')).seeds, 19);
  await assert.rejects(f.service.command('alice', command('plant-1', 'harvest')), /不同内容/);
  await assert.rejects(f.service.command('alice', command('early', 'harvest')), /尚未成熟/);
  f.advance(99999); assert.equal((await f.service.state('alice')).crops[0].stage, 0);
  f.advance(1); assert.equal((await f.service.state('alice')).crops[0].stage, 1);
  f.advance(100000); assert.equal((await f.service.state('alice')).crops[0].stage, 2);
  f.advance(99999); await assert.rejects(f.service.command('alice', command('early2', 'harvest')), /尚未成熟/);
  f.advance(1);
  await assert.rejects(f.service.command('alice', command('early', 'harvest')), /尚未成熟/);
  await assert.rejects(f.service.command('alice', command('early', 'plant')), /不同内容/);
  const restarted = f.restart(); assert.equal((await restarted.state('alice')).crops[0].stage, 3);
  const [first, second] = await Promise.all([restarted.command('alice', command('harvest-1', 'harvest')), restarted.command('alice', command('harvest-1', 'harvest'))]);
  assert.deepEqual(first, second); assert.equal(first.session.seeds, 20); assert.equal(first.session.vegetables, 1);
  await assert.rejects(restarted.command('alice', command('harvest-2', 'harvest')), /尚未成熟/);
  assert.equal((await f.restart().state('alice')).vegetables, 1);
}));

test('movement bounds, speed, field distance, insufficient seeds and malicious commands fail without changes', async () => fixture(async f => {
  await f.service.bootstrap('alice', { snapshot: farmMap() });
  await assert.rejects(f.service.move('alice', { x: 3000, y: 160, facing: 'right' }), /移动距离/);
  await assert.rejects(f.service.move('alice', { x: NaN, y: 160, facing: 'down' }), /位置/);
  await assert.rejects(f.service.command('alice', command('invalid', 'plant', { column: 10, row: 10, seeds: 999 })), /不支持/);
  const row = await f.db.getRepository(GhomeWorld).findOneByOrFail({ ownerId: 'alice' });
  const runtime = JSON.parse(row.runtimeJson); runtime.seeds = 0;
  await f.db.getRepository(GhomeWorld).update(row.id, { runtimeJson: JSON.stringify(runtime) });
  await assert.rejects(f.restart().command('alice', command('no-seeds', 'plant')), /种子不足/);
  f.advance(1000); await f.service.move('alice', { x: 220, y: 164.8, facing: 'right' });
  await assert.rejects(f.service.command('alice', command('too-far', 'plant')), /靠近/);
  await f.service.flush(); assert.equal((await f.restart().state('alice')).player.x, 220);
}));

test('map revision rejects stale edits and editor snapshots cannot reset crop timers or rewards', async () => fixture(async f => {
  const initial = await f.service.bootstrap('alice', { snapshot: farmMap() });
  await f.service.command('alice', command('plant', 'plant'));
  const edited = initial.map; edited.cells[20][20].base = 'soil'; edited.crops.push({ column: 20, row: 20, stage: 3 });
  edited.crops[0].stage = 3;
  const saved = await f.service.command('alice', command('map-1', 'map', { snapshot: edited, baseMapRevision: 1 }));
  assert.equal(saved.session.mapRevision, 2); assert.equal(saved.session.crops.length, 1); assert.equal(saved.session.crops[0].stage, 0);
  await assert.rejects(f.service.command('alice', command('map-stale', 'map', { snapshot: edited, baseMapRevision: 1 })), /地图已更新/);
  const removed = JSON.parse(JSON.stringify(edited)); removed.cells[10][10].base = 'grass'; removed.crops = removed.crops.filter((crop: any) => crop.column !== 10);
  await assert.rejects(f.service.command('alice', command('map-delete', 'map', { snapshot: removed, baseMapRevision: 2 })), /先收获/);
  f.advance(GROWTH_MS); assert.equal((await f.restart().state('alice')).crops[0].stage, 3);
}));

test('database transaction failure neither charges seeds nor publishes success', async () => fixture(async f => {
  await f.service.bootstrap('alice', { snapshot: farmMap() });
  await f.db.query("CREATE TRIGGER fail_receipt BEFORE INSERT ON ghome_commands BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  await assert.rejects(f.service.command('alice', command('plant-fail', 'plant')), /test failure/);
  assert.equal((await f.service.state('alice')).seeds, 20); assert.equal((await f.restart().state('alice')).crops.length, 0);
  await f.db.query('DROP TRIGGER fail_receipt');
  await f.service.command('alice', command('plant-fail', 'plant')); assert.equal((await f.service.state('alice')).seeds, 19);
}));

test('clock, deterministic weather, environment settings and backwards wall-clock survive release', async () => fixture(async f => {
  await f.service.bootstrap('alice', { snapshot: farmMap() });
  const initial = await f.service.state('alice');
  f.advance(24 * 60000); const next = await f.service.state('alice'); assert.equal(next.environment.dayNumber, 2); assert.equal(next.environment.time, '08:00');
  await f.service.command('alice', command('environment', 'environment', { minute: 1320, seasonIndex: 3, weatherKind: 'snow' }));
  await f.service.release('alice'); const resumed = await f.service.state('alice'); assert.equal(resumed.environment.time, '22:00'); assert.equal(resumed.environment.weatherKind, 'snow');
  f.advance(-10000); assert.equal((await f.service.state('alice')).serverNow, resumed.serverNow);
  assert.equal((await f.restart().state('alice')).environment.weatherKind, 'snow');
  assert.equal(initial.worldId, resumed.worldId);
}));

test('ported terrain rules stay byte-identical to frontend and support full map round-trips', () => {
  for (const path of ['build/WorldModel.js', 'WorldGenerator.js', 'hills.js']) {
    const backend = readFileSync(join(__dirname, 'core', path), 'utf8');
    const frontend = readFileSync(join(__dirname, '../../..', 'HStudioApp/src/components/ghome/runtime', path), 'utf8');
    assert.equal(backend, frontend);
  }
  const map = createInitialWorld(); const model = new WorldModel(map); assert.deepEqual(validateSnapshot(model.snapshot()), map);
});

test('speed budget cannot be multiplied by rapid packets and movement cannot cross water', async () => fixture(async f => {
  await f.service.bootstrap('alice', { snapshot: farmMap() }); f.advance(1000);
  await f.service.move('alice', { x: 220, y: 164.8, facing: 'right' });
  await f.service.move('alice', { x: 236, y: 164.8, facing: 'right' });
  await assert.rejects(f.service.move('alice', { x: 252, y: 164.8, facing: 'right' }), /移动距离/);
  const map = farmMap(); map.cells[10][11].base = 'water';
  await f.service.bootstrap('bob', { snapshot: map }); f.advance(1000);
  await assert.rejects(f.service.move('bob', { x: 200, y: 164.8, facing: 'right' }), /路径/);
  assert.equal((await f.service.state('bob')).player.x, 168);
}));

test('stable creature identities persist while invalid positions and forged IDs cannot enter checkpoints', async () => fixture(async f => {
  await f.service.bootstrap('alice', { snapshot: farmMap() });
  const catalog = JSON.parse(readFileSync(join(__dirname, 'core/catalog.json'), 'utf8'));
  const definition = catalog.creatures.find((entry: any) => entry.movementMode === 'walk');
  const creature = { id: definition.id, type: definition.type, x: 500, y: 500, facing: 'down' };
  await f.service.checkpoint('alice', { creatures: [creature] });
  assert.deepEqual((await f.restart().state('alice')).creatures[0], creature);
  await f.service.checkpoint('alice', { creatures: [{ ...creature, x: -999 }] });
  assert.equal((await f.service.state('alice')).creatures[0].x, 500);
  await assert.rejects(f.service.checkpoint('alice', { creatures: [{ ...creature, id: 'forged' }] }), /未知/);
  await assert.rejects(f.service.checkpoint('alice', { creatures: [creature, creature] }), /重复/);
}));
