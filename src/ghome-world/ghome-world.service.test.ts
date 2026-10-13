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
import { GhomePlayer, GhomeWorldCreation, GhomeSaveArchive } from '../database/entities/ghome-player.entity';
import { InitGhomeSaveArchive1710000000006 } from '../database/migrations/1710000000006-InitGhomeSaveArchive';
import { InitGhomePlayer1710000000005 } from '../database/migrations/1710000000005-InitGhomePlayer';
import { GhomeWorld, GhomeCommandReceipt } from '../database/entities/ghome-world.entity';
import { InitAuth1710000000000 } from '../database/migrations/1710000000000-InitAuth';
import { InitGhomeWorld1710000000004 } from '../database/migrations/1710000000004-InitGhomeWorld';
import { GhomeWorldService, GROWTH_MS } from './ghome-world.service';
import WorldModel, { createInitialWorld, validateSnapshot } from './core/build/WorldModel.js';
import defaultIsland from './core/default-island.json';

async function fixture(run: (f: { db: DataSource; service: GhomeWorldService; advance: (ms: number) => void; restart: () => GhomeWorldService }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'ghome-world-'));
  const db = new DataSource({ type: 'better-sqlite3', database: join(directory, 'world.sqlite'),
    entities: [GhomeWorld, GhomeCommandReceipt, GhomePlayer, GhomeWorldCreation, GhomeSaveArchive], migrations: [InitAuth1710000000000, InitGhomeWorld1710000000004, InitGhomePlayer1710000000005, InitGhomeSaveArchive1710000000006] });
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

async function ready(service: GhomeWorldService, ownerId = 'alice') {
  for (let i = 0; i < 100; i++) {
    const entry = await service.entry(ownerId);
    if (entry.world?.status === 'READY' || entry.world?.status === 'FAILED') return entry;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('Creation did not finish');
}
const appearance = JSON.parse(readFileSync(join(__dirname, 'core/catalog.json'), 'utf8')).defaultCharacter;
test('new journey separates player creation, deduplicates double clicks, and persists identity/template/runtime', async () => fixture(async f => {
  assert.deepEqual(await f.service.entry('alice'), { player: null, world: null });
  await assert.rejects(f.service.createWorld('alice', { name: '星芽岛', templateId: 'sprout_island' }), /先创建角色/);
  await assert.rejects(f.service.createPlayer('alice', { nickname: '  ', appearance }), /昵称/);
  await assert.rejects(f.service.createPlayer('alice', { nickname: '岛民', appearance: {} }), /外观/);
  const [a, b] = await Promise.all([f.service.createPlayer('alice', { nickname: '海风', appearance }), f.service.createPlayer('alice', { nickname: '海风', appearance })]);
  assert.equal(a.id, b.id); assert.equal((await f.service.entry('alice')).world, null);
  const restarted = f.restart(); assert.equal((await restarted.entry('alice')).player?.nickname, '海风');
  await assert.rejects(restarted.createWorld('alice', { name: '星芽岛', templateId: 'hill' }), /尚未开放/);
  const [one, two] = await Promise.all([restarted.createWorld('alice', { name: '星芽岛', templateId: 'sprout_island' }), restarted.createWorld('alice', { name: '第二座岛', templateId: 'sprout_island' })]);
  assert.equal(one.worldId, two.worldId);
  const entry = await ready(restarted); assert.equal(entry.world?.status, 'READY'); assert.equal(entry.world?.completed, 3); assert.equal(entry.world?.name, '星芽岛');
  const saved = await f.restart().read('alice'); assert.equal(saved.worldId, one.worldId); assert.deepEqual(saved.map, defaultIsland);
  assert.equal(saved.session.identity?.nickname, '海风'); assert.equal(saved.session.identity?.worldName, '星芽岛');
  assert.equal(saved.session.seeds, 20); assert.equal(saved.session.tutorial?.step, 'arrival'); assert.equal(saved.session.environment.time, '08:00');
  assert.equal(await f.db.getRepository(GhomeWorld).count(), 1);
  const customized = { ...appearance, hairColor: 'black' };
  await restarted.command('alice', command('customize', 'appearance', customized));
  assert.deepEqual((await f.restart().entry('alice')).player?.appearance, customized);
  assert.deepEqual((await f.restart().read('alice')).session.appearance, customized);
  assert.equal((await f.service.entry('bob')).player, null);
}));

test('failed creation retains character and name; retry and interrupted initialization reuse the same world', async () => fixture(async f => {
  await f.service.createPlayer('alice', { nickname: '海风', appearance });
  const original = f.service.read.bind(f.service);
  f.service.read = async () => { throw Error('injected storage outage'); };
  const creation = await f.service.createWorld('alice', { name: '星芽岛', templateId: 'sprout_island' });
  const failed = await ready(f.service); assert.equal(failed.world?.status, 'FAILED'); assert.equal(failed.world?.name, '星芽岛'); assert.equal(failed.player?.nickname, '海风');
  assert.equal(failed.world?.error, '小岛初始化暂时失败，请重试');
  f.service.read = original;
  const restarted = f.restart(); await restarted.retryCreation('alice');
  assert.equal((await ready(restarted)).world?.status, 'READY'); assert.equal((await restarted.read('alice')).worldId, creation.worldId);
  // A process shutdown between persisted tasks leaves INITIALIZING; entry resumes it.
  await f.db.getRepository(GhomeWorldCreation).update('alice', { status: 'INITIALIZING', completed: 1 });
  const recovered = f.restart(); assert.equal((await recovered.entry('alice')).world?.status, 'INITIALIZING');
  assert.equal((await ready(recovered)).world?.status, 'READY'); assert.equal(await f.db.getRepository(GhomeWorld).count(), 1);
}));

test('existing worlds bypass onboarding without changing maps, appearance, crops or resource counts', async () => fixture(async f => {
  const before = await f.service.bootstrap('alice', { snapshot: farmMap(2) });
  const entry = await f.service.entry('alice'); assert.equal(entry.world?.status, 'READY'); assert.ok(entry.player?.id);
  const after = await f.restart().read('alice'); assert.deepEqual(after, before);
  await assert.rejects(f.service.createWorld('alice', { name: '覆盖岛', templateId: 'sprout_island' }), /已有世界/);
  assert.equal(await f.db.getRepository(GhomeWorldCreation).count(), 0);
}));

test('arrival, moving, gift pickup and first construction are authoritative and resume across restarts', async () => fixture(async f => {
  await f.service.createPlayer('alice', { nickname: '海风', appearance });
  await f.service.createWorld('alice', { name: '星芽岛', templateId: 'sprout_island' }); await ready(f.service);
  await assert.rejects(f.service.command('alice', command('early-gift', 'starter-gift', {})), /先试着移动/);
  const arrival = await f.service.command('alice', command('landfall', 'arrival', {})); assert.equal(arrival.session.tutorial?.step, 'move');
  const player = arrival.session.player; f.advance(1000);
  await f.service.move('alice', { ...player, x: player.x + 16 });
  assert.equal((await f.restart().state('alice')).tutorial?.step, 'gift');
  const gift = await f.service.command('alice', command('gift-1', 'starter-gift', {})); assert.equal(gift.session.seeds, 25); assert.equal(gift.session.tutorial?.step, 'build');
  await f.service.command('alice', command('gift-1', 'starter-gift', {}));
  await f.service.command('alice', command('gift-2', 'starter-gift', {})); assert.equal((await f.service.state('alice')).seeds, 25);
  const world = await f.service.read('alice'); const model: any = new WorldModel(world.map);
  let object: any;
  for (let row = 0; row < world.map.rows && !object; row++) for (let column = 0; column < world.map.columns; column++) {
    const candidate = { id: 'first-decoration', type: 'fence', column, row };
    if (!model.placementReason(candidate)) { object = candidate; break; }
  }
  assert.ok(object); world.map.objects.push(object);
  const built = await f.service.command('alice', command('first-build', 'map', { snapshot: world.map, baseMapRevision: world.mapRevision }));
  assert.equal(built.session.tutorial?.step, 'done'); assert.equal((await f.restart().state('alice')).tutorial?.step, 'done');
}));

test('returning to character creation updates the same player, and locks once the island starts', async () => fixture(async f => {
  const player = await f.service.createPlayer('alice', { nickname: '海风', appearance });
  const customized = { ...appearance, clothes: 'green', hair: 'lyria' };
  const updated = await f.service.updatePlayer('alice', { nickname: '青禾', appearance: customized });
  assert.equal(updated.id, player.id); assert.equal(updated.nickname, '青禾');
  assert.deepEqual((await f.restart().entry('alice')).player?.appearance, customized);
  const saves = await f.service.saves('alice'); assert.equal(saves.saves.length, 1); assert.equal(saves.saves[0].world, null);
  await f.service.createWorld('alice', { name: '星芽岛', templateId: 'sprout_island' });
  await assert.rejects(f.service.updatePlayer('alice', { nickname: '不能覆盖', appearance }), /小岛已开始创建/);
  await ready(f.service); assert.equal((await f.service.read('alice')).session.identity?.nickname, '青禾');
}));

test('save deletion archives maps, resources, positions and receipts; restore is isolated and exact', async () => fixture(async f => {
  await f.service.bootstrap('alice', { snapshot: farmMap() });
  const player = (await f.service.entry('alice')).player!;
  await f.service.command('alice', command('before-delete', 'plant')); f.advance(1000);
  await f.service.move('alice', { x: 176, y: 164.8, facing: 'right' });
  const before = await f.service.read('alice');
  assert.equal((await f.service.saves('alice')).saves[0].id, player.id);
  await assert.rejects(f.service.deleteSave('bob', player.id), /不存在/);
  const backup = await f.service.deleteSave('alice', player.id);
  assert.equal((await f.service.saves('alice')).saves.length, 0); assert.equal((await f.service.saves('alice')).deleted?.id, backup.archiveId);
  assert.deepEqual(await f.service.entry('alice'), { player: null, world: null });
  await assert.rejects(f.service.read('alice'), /尚未创建/);
  await assert.rejects(f.service.command('alice', command('stale-client', 'plant')), /尚未创建/);
  await assert.rejects(f.service.restoreSave('bob', backup.archiveId), /不存在/);
  await f.restart().restoreSave('alice', backup.archiveId);
  const restored = await f.restart().read('alice'); assert.deepEqual(restored, before);
  assert.equal((await f.service.saves('alice')).deleted, null);
  await f.service.command('alice', command('before-delete', 'plant')); assert.equal((await f.service.state('alice')).seeds, 19);
  const second = await f.service.deleteSave('alice', player.id);
  const fresh = await f.service.createPlayer('alice', { nickname: '新旅程', appearance }); assert.notEqual(fresh.id, player.id);
  await assert.rejects(f.service.restoreSave('alice', second.archiveId), /无法覆盖恢复/);
}));

test('save deletion is transactional and cannot race incomplete world initialization', async () => fixture(async f => {
  const player = await f.service.createPlayer('alice', { nickname: '海风', appearance });
  await f.service.createWorld('alice', { name: '星芽岛', templateId: 'sprout_island' });
  await assert.rejects(f.service.deleteSave('alice', player.id), /正在初始化/); await ready(f.service);
  const transaction = f.db.transaction.bind(f.db);
  f.db.transaction = (async () => { throw Error('injected disk failure'); }) as any;
  await assert.rejects(f.service.deleteSave('alice', player.id), /disk failure/);
  assert.equal((await f.service.saves('alice')).saves.length, 1); assert.equal(await f.db.getRepository(GhomeSaveArchive).count(), 0);
  f.db.transaction = transaction;
  const backup = await f.service.deleteSave('alice', player.id); await f.service.restoreSave('alice', backup.archiveId);
  assert.equal((await f.restart().entry('alice')).world?.status, 'READY');
}));
