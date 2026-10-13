import { generateWorld, hillTiles, validateGeneratorOptions } from '../WorldGenerator.js';
import { irregularHill, paintedHill, HILL_WALKABLE, HILL_STAIRS, hillCliffBounds } from '../hills.js';
export { HILL_WALKABLE };

export const MAP_NAME = '芽芽岛';
export const MAP_COLUMNS = 128;
export const MAP_ROWS = 96;
export const TILE = 16;
export const STORAGE_KEY = 'hstudio:ghome:world:v2';
export const MAP_VERSION = 'sprout-island-2';
export const WORLD_VERSION = 3;
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const isHillTopFrame = (frame) => frame >= 55 && frame <= 60;
export const DEFINITIONS = {
  hill: { name: '随机山丘', category: 'landscape', width: 4, height: 4, structure: 'hill' },
  house: { name: '木屋', category: 'building', width: 3, height: 2, texture: 'house' },
  coop: { name: '鸡舍', category: 'building', width: 3, height: 2, texture: 'coop' },
  'bridge-h': { name: '横向小桥', category: 'building', width: 3, height: 2, texture: 'bridge-h', structure: 'bridge' },
  'bridge-v': { name: '纵向小桥', category: 'building', width: 2, height: 3, texture: 'bridge-v', structure: 'bridge' },
  tree: { name: '普通树', category: 'decoration', width: 1, height: 1, texture: 'tree' },
  'blossom-tree': { name: '樱花树', category: 'decoration', width: 2, height: 1, texture: 'blossom-tree' },
  rock: { name: '石块', category: 'decoration', width: 1, height: 1, texture: 'rock' },
  fence: { name: '栅栏', category: 'decoration', width: 1, height: 1, texture: 'fence', frame: 5 },
  'hill-large': { name: '大山丘', category: 'landscape', width: 6, height: 5, structure: 'hill', tiles: [
    [0, 1, 1, 1, 1, 2], [11, 55, 56, 57, 58, 13], [11, 57, 58, 59, 60, 13],
    [22, 23, 64, 65, 23, 24], [-1, -1, 75, 76, -1, -1],
  ] },
  'hill-small': { name: '小山丘', category: 'landscape', width: 4, height: 4, structure: 'hill', tiles: [
    [0, 1, 1, 2], [11, 55, 56, 13], [22, 64, 65, 24], [-1, 75, 76, -1],
  ] },
};
export const TERRAIN_TOOLS = [
  { type: 'water', name: '海域', icon: '≈' }, { type: 'inland-water', name: '水域', icon: '≋' },
  { type: 'sand', name: '沙地', icon: '∴' }, { type: 'land', name: '土地', icon: '▧' },
  { type: 'grass', name: '草地', icon: '♧' }, { type: 'soil', name: '农田', icon: '▨' },
  { type: 'hill', name: '山丘', icon: '▴' },
];
export const ROAD_TOOLS = [
  { type: 'wooden-path', name: '木板路', icon: '≡' }, { type: 'gravel-road', name: '碎石路', icon: '⁙' },
  { type: 'hill-road', name: '山丘道路', icon: '▤' },
];
export const ROAD_NAMES = ['wooden-path', 'gravel-road'];
const BASES = ['water', 'grass', 'soil', 'land', 'sand'];
// The existing water base remains ocean so old saves retain their coastline.
export const isWaterCell = (cell) => !!cell && (cell.base === 'water' || cell.inlandWater === true);
export function createInitialWorld(options) {
  return { version: WORLD_VERSION, mapVersion: MAP_VERSION, columns: MAP_COLUMNS, rows: MAP_ROWS,
    ...generateWorld(MAP_COLUMNS, MAP_ROWS, options) };
}
const hillDefinitions = new WeakMap();
export function objectDefinition(object) {
  const definition = DEFINITIONS[object.type];
  if (object.type !== 'hill') return definition;
  const cached = hillDefinitions.get(object);
  if (cached && cached.width === object.width && cached.height === object.height && cached.shapeSeed === object.shapeSeed && cached.footprint === object.footprint && cached.paths === object.paths) return cached;
  const hill = object.footprint ? paintedHill(object.width, object.height, object.footprint, object.column, object.row, object.shapeSeed, object.paths)
    : object.shapeSeed === undefined ? { tiles: hillTiles(object.width, object.height) }
    : irregularHill(object.width, object.height, object.shapeSeed);
  const result = { ...definition, width: object.width, height: object.height, shapeSeed: object.shapeSeed, footprint: object.footprint, paths: object.paths, ...hill };
  hillDefinitions.set(object, result);
  return result;
}
export function objectCells(object) {
  const definition = objectDefinition(object);
  const cells = [];
  if (!definition) return cells;
  for (let y = 0; y < definition.height; y += 1) for (let x = 0; x < definition.width; x += 1) {
    if (definition.tiles?.[y]?.[x] === -1) continue;
    cells.push({ column: object.column + x, row: object.row + y, x, y });
  }
  return cells;
}
function hillLandings(object) {
  return (objectDefinition(object).entrances || []).flatMap(({ x, y, dx, dy }) => [-1, 2].flatMap((step) => [0, 1].map((offset) => ({
    column: object.column + x + dx * step + (dy ? offset : 0),
    row: object.row + y + dy * step + (dx ? offset : 0),
  }))));
}
export function objectBounds(object) {
  const d = objectDefinition(object);
  if (object.legacy && object.type === 'coop') return { x: 17.4 * TILE - 12, y: 18.1 * TILE - 5, width: 24, height: 10 };
  const width = d.width * TILE;
  const treeCenter = object.legacy ? TILE / 2 : width / 2;
  const height = d.height * TILE;
  return { x: object.column * TILE + (object.type.includes('tree') ? treeCenter - 4.5 : 1),
    y: (object.row + d.height) * TILE - (object.type.includes('tree') ? 7.5 : height - 1),
    width: object.type.includes('tree') ? 9 : width - 2, height: object.type.includes('tree') ? 7 : height - 2 };
}
export function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
export default class WorldModel {
  constructor(snapshot = createInitialWorld()) { this.restore(snapshot); }
  restore(snapshot) { this.data = clone(snapshot); }
  snapshot() { return clone(this.data); }
  cell(column, row) { return this.data.cells[row]?.[column]; }
  isAncestor(id, object) {
    const seen = new Set();
    while (object?.parentId && !seen.has(object.parentId)) {
      if (object.parentId === id) return true;
      seen.add(object.parentId);
      object = this.data.objects.find((entry) => entry.id === object.parentId);
    }
    return false;
  }
  hillDepth(object) {
    let depth = 0; const seen = new Set();
    while (object && !seen.has(object.id)) {
      depth += 1; seen.add(object.id);
      object = this.data.objects.find((entry) => entry.id === object.parentId);
    }
    return depth;
  }
  clearExampleHills() {
    const removed = this.data.objects.filter((entry) => objectDefinition(entry).structure === 'hill' && !entry.footprint);
    if (!removed.length) return 0;
    const ids = new Set(removed.map(({ id }) => id));
    this.data.objects = this.data.objects.filter((entry) => !ids.has(entry.id));
    for (const entry of this.data.objects) {
      while (ids.has(entry.parentId)) {
        const parent = removed.find(({ id }) => id === entry.parentId);
        if (parent.parentId) entry.parentId = parent.parentId;
        else delete entry.parentId;
      }
    }
    this.data.cells.forEach((line, row) => line.forEach((cell, column) => {
      if (cell.hillSurface && !this.hillAt(column, row)) { cell.base = cell.hillSurface; delete cell.hillSurface; }
    }));
    return removed.length;
  }
  at(column, row, excludeId) {
    const occupies = (object) => object.id !== excludeId && objectCells(object).some((cell) => cell.column === column && cell.row === row);
    return this.data.objects.find((object) => objectDefinition(object).structure !== 'hill' && occupies(object)) || this.hillAt(column, row, excludeId);
  }
  hillAt(column, row, excludeId) {
    const occupies = (object) => {
      const d = objectDefinition(object);
      const frame = d.tiles?.[row - object.row]?.[column - object.column];
      return object.id !== excludeId && d.structure === 'hill' && frame !== undefined && frame >= 0;
    };
    return this.data.objects.filter(occupies).reduce((highest, object) => !highest || this.hillDepth(object) > this.hillDepth(highest) ? object : highest, undefined);
  }
  surfaceBase(column, row) {
    const hill = this.hillAt(column, row);
    if (!hill) return this.cell(column, row)?.base;
    return isHillTopFrame(objectDefinition(hill).tiles[row - hill.row]?.[column - hill.column])
      ? this.cell(column, row)?.hillSurface || 'grass' : null;
  }
  syncFarmSpot(column, row) {
    const cell = this.cell(column, row);
    const existing = this.data.crops.find((crop) => crop.column === column && crop.row === row);
    const occupant = this.at(column, row);
    const plantable = this.surfaceBase(column, row) === 'soil' && !cell.road && !isWaterCell(cell)
      && (!occupant || objectDefinition(occupant).structure === 'hill');
    if (plantable && !existing) this.data.crops = [...this.data.crops, { column, row, stage: -1 }];
    else if (!plantable && existing) this.data.crops = this.data.crops.filter((crop) => crop !== existing);
  }
  terrain(column, row) {
    const cell = this.cell(column, row);
    if (!cell) return 'water';
    const object = this.hillAt(column, row) || this.at(column, row);
    const d = object && objectDefinition(object);
    if (d?.structure === 'bridge') return 'bridge';
    if (d?.structure === 'hill') {
      const frame = d.tiles[row - object.row][column - object.column];
      if (!HILL_WALKABLE.includes(frame)) return 'cliff';
      if (!isHillTopFrame(frame)) return 'hill';
      return cell.road ? 'road' : cell.hillSurface === 'soil' ? 'farm' : cell.hillSurface || 'hill';
    }
    if (isWaterCell(cell)) return 'water';
    return cell.road ? 'road' : cell.base === 'soil' ? 'farm' : cell.base;
  }
  cliffBounds(column, row) {
    const hill = this.hillAt(column, row);
    if (!hill) return [];
    const frame = objectDefinition(hill).tiles[row - hill.row][column - hill.column];
    return hillCliffBounds(frame, TILE).map((b) => ({ ...b, x: b.x + column * TILE, y: b.y + row * TILE }));
  }
  canOccupyTerrain(actor, mode = 'walk') {
    for (let row = Math.floor(actor.y / TILE); row <= Math.floor((actor.y + actor.height - 0.001) / TILE); row += 1) {
      for (let column = Math.floor(actor.x / TILE); column <= Math.floor((actor.x + actor.width - 0.001) / TILE); column += 1) {
        if (!this.cell(column, row)) return false;
        const terrain = this.terrain(column, row);
        if (mode !== 'walk') { if (terrain !== 'water') return false; }
        else if (terrain === 'water' || (terrain === 'cliff' && this.cliffBounds(column, row).some((b) => intersects(actor, b)))) return false;
      }
    }
    return true;
  }
  safeActors(actors = []) {
    return actors.every((actor) => this.canOccupyTerrain(actor, actor.movementMode || 'walk')
      && !this.data.objects.some((object) => !DEFINITIONS[object.type].structure && intersects(actor, objectBounds(object))));
  }
  placementReason(object, excludeId = object.id) {
    const d = objectDefinition(object);
    if (!d) return '未知物件';
    const parent = object.parentId && this.data.objects.find((entry) => entry.id === object.parentId);
    if (object.parentId && (object.type !== 'hill' || !parent || parent.type !== 'hill' || this.isAncestor(object.id, object))) return '山丘需要有效且不循环的下层支撑';
    const supports = (hill, column, row) => {
      return isHillTopFrame(objectDefinition(hill).tiles[row - hill.row]?.[column - hill.column]);
    };
    const existingHill = d.structure === 'hill' && this.data.objects.some((entry) => entry.id === object.id);
    const levels = new Set();
    for (const { column, row, x, y } of objectCells(object)) {
      const cell = this.cell(column, row);
      if (!cell) return '超出地图边界';
      if (parent && !(objectDefinition(parent).tiles[row - parent.row]?.[column - parent.column] >= 0)) return '叠加山丘需要下层山丘支撑';
      const overlaps = this.data.objects.filter((entry) => entry.id !== excludeId && objectCells(entry).some((cell) => cell.column === column && cell.row === row));
      if (overlaps.some((entry) => {
        if (this.isAncestor(entry.id, object)) return false;
        if (existingHill && (this.isAncestor(object.id, entry) || (supports(object, column, row) && !objectDefinition(entry).structure))) return false;
        if (!d.structure && objectDefinition(entry).structure === 'hill' && supports(entry, column, row)) return false;
        return true;
      })) return '已有物件占用，或占地包含崖壁和阶梯';
      if (!d.structure) levels.add(this.hillAt(column, row)?.id || 'ground');
      if (levels.size > 1) return '建筑和装饰需要放在同一层平坦区域';
      const hillSurface = existingHill && supports(object, column, row);
      if (!hillSurface && this.data.crops.some((crop) => crop.column === column && crop.row === row)) return '请先改造农田';
      if (!hillSurface && cell.road) return '请先移除占地内的道路';
      if (d.structure === 'bridge') {
        const middle = object.type === 'bridge-h' ? x === 1 : y === 1;
        if (middle ? !isWaterCell(cell) : isWaterCell(cell)) return '小桥需要一格宽水道和两侧陆地';
      } else if (isWaterCell(cell)) return '需要陆地支撑';
    }
    for (const { column, row } of hillLandings(object)) {
      const occupant = this.at(column, row, excludeId);
      if (!this.cell(column, row) || isWaterCell(this.cell(column, row)) || (occupant && occupant.id !== parent?.id)
        || (parent && !supports(parent, column, row))) return '上下山路径需要连通空闲陆地';
    }
    const occupied = new Set(objectCells(object).map(({ column, row }) => `${column},${row}`));
    if (this.data.objects.some((entry) => entry.id !== excludeId && !this.isAncestor(object.id, entry) && entry.type === 'hill'
      && hillLandings(entry).some(({ column, row }) => occupied.has(`${column},${row}`)))) return '不能阻挡上下山路径';
    return '';
  }
  paintReason(column, row, tool) {
    const cell = this.cell(column, row);
    if (!cell) return '超出地图边界';
    if (['water', 'inland-water'].includes(tool) && this.data.objects.some((entry) => entry.type === 'hill'
      && hillLandings(entry).some((landing) => landing.column === column && landing.row === row))) return '上下山路径需要连通陆地';
    const object = this.at(column, row);
    const hill = this.hillAt(column, row);
    if (hill) {
      if (!isHillTopFrame(objectDefinition(hill).tiles[row - hill.row]?.[column - hill.column])) return '崖壁和阶梯不可编辑';
      if (['water', 'inland-water'].includes(tool)) return '山丘顶面不能改为水域';
    }
    if (object && objectDefinition(object).structure === 'bridge') return '请先移动或拆除桥梁';
    if (object && objectDefinition(object).structure !== 'hill'
      && (tool === 'water' || tool === 'inland-water' || ROAD_NAMES.includes(tool))) return '物件占地不能改为水域或道路';
    if (tool === 'inland-water' && !['grass', 'sand'].includes(cell.base)) return '水域只能绘制在草地或沙地上';
    if (ROAD_NAMES.includes(tool) && isWaterCell(cell)) return '道路只能铺在陆地';
    return '';
  }
}
export function validateSnapshot(value) {
  if (!value || ![1, 2, WORLD_VERSION].includes(value.version) || value.mapVersion !== MAP_VERSION || value.columns !== MAP_COLUMNS || value.rows !== MAP_ROWS) throw new Error('存档版本或地图不匹配');
  if (!Array.isArray(value.cells) || value.cells.length !== MAP_ROWS || !value.cells.every((row) => Array.isArray(row) && row.length === MAP_COLUMNS && row.every((cell) =>
    cell && BASES.includes(cell.base) && (cell.base !== 'land' || value.version === WORLD_VERSION)
      && (cell.road === null || ROAD_NAMES.includes(cell.road)) && !(isWaterCell(cell) && cell.road)
      && (cell.inlandWater === undefined || (value.version >= 2 && cell.inlandWater === true && ['grass', 'sand'].includes(cell.base)))
      && (cell.hillSurface === undefined || (value.version === WORLD_VERSION && ['grass', 'soil', 'land', 'sand'].includes(cell.hillSurface)))))) throw new Error('地形数据异常');
  if (!Array.isArray(value.objects) || value.objects.length > MAP_COLUMNS * MAP_ROWS || !Array.isArray(value.crops) || value.crops.length > MAP_COLUMNS * MAP_ROWS) throw new Error('对象数据异常');
  const ids = new Set();
  if (value.generator) validateGeneratorOptions(value.generator);
  if (value.spawn && (!Number.isInteger(value.spawn.column) || !Number.isInteger(value.spawn.row)
    || value.spawn.column < 0 || value.spawn.column >= MAP_COLUMNS || value.spawn.row < 0 || value.spawn.row >= MAP_ROWS)) throw new Error('出生点异常');
  for (const object of value.objects) {
    if (!object || typeof object.id !== 'string' || !object.id || object.id.length > 100 || ids.has(object.id) || !Object.prototype.hasOwnProperty.call(DEFINITIONS, object.type) || !Number.isInteger(object.column) || !Number.isInteger(object.row)) throw new Error('物件数据异常');
    ids.add(object.id);
    if (object.legacy) throw new Error('原始物件位置异常');
    if (object.type === 'hill') {
      const irregular = object.shapeSeed !== undefined;
      const nested = object.parentId !== undefined;
      if (nested && (!irregular || typeof object.parentId !== 'string' || !object.parentId || object.parentId === object.id)) throw new Error('山丘层级异常');
      if (irregular && (typeof object.shapeSeed !== 'string' || !object.shapeSeed || object.shapeSeed.length > 100)) throw new Error('山丘种子异常');
      if (object.paths !== undefined && (!object.footprint || !Array.isArray(object.paths) || object.paths.length > MAP_COLUMNS * MAP_ROWS
        || !object.paths.every((path) => path && Number.isInteger(path.column) && Number.isInteger(path.row)
          && HILL_STAIRS.some(({ side }) => side === path.side)))) throw new Error('山丘道路数据异常');
      if (object.footprint !== undefined) {
        const footprint = object.footprint;
        if (!irregular || !Array.isArray(footprint) || !footprint.length || footprint.length > MAP_COLUMNS * MAP_ROWS
          || !footprint.every((cell) => Array.isArray(cell) && cell.length === 2 && Number.isInteger(cell[0]) && Number.isInteger(cell[1])
            && cell[0] >= 0 && cell[0] < MAP_COLUMNS && cell[1] >= 0 && cell[1] < MAP_ROWS)
          || new Set(footprint.map(([x, y]) => `${x},${y}`)).size !== footprint.length) throw new Error('山丘拼接数据异常');
        const xs = footprint.map(([x]) => x); const ys = footprint.map(([, y]) => y);
        if (object.column !== Math.min(...xs) - 1 || object.row !== Math.min(...ys) - 1
          || object.width !== Math.max(...xs) - object.column + 2 || object.height !== Math.max(...ys) - object.row + 2) throw new Error('山丘拼接边界异常');
      } else if (!Number.isInteger(object.width) || object.width < (nested ? 12 : irregular ? 18 : 4) || object.width > (nested ? 16 : irregular ? 28 : 12)
        || !Number.isInteger(object.height) || object.height < (nested ? 10 : irregular ? 14 : 4) || object.height > (nested ? 12 : irregular ? 22 : 9)) throw new Error('山丘尺寸异常');
    }
    else if (object.parentId !== undefined) throw new Error('只有山丘支持叠加');
  }
  const model = new WorldModel({ ...value, version: WORLD_VERSION });
  value.cells.forEach((line, row) => line.forEach((cell, column) => {
    if (cell.hillSurface !== undefined && (!model.hillAt(column, row) || !model.surfaceBase(column, row))) throw new Error('山丘地表数据异常');
  }));
  const cropKeys = new Set();
  for (const crop of value.crops) {
    const key = `${crop?.column},${crop?.row}`;
    if (!crop || !Number.isInteger(crop.column) || !Number.isInteger(crop.row) || !Number.isInteger(crop.stage) || crop.stage < -1 || crop.stage > 3 || model.surfaceBase(crop.column, crop.row) !== 'soil' || value.cells[crop.row][crop.column].road || cropKeys.has(key)) throw new Error('农田数据异常');
    cropKeys.add(key);
  }
  for (const object of value.objects) {
    const reason = model.placementReason(object);
    if (reason) throw new Error(`物件占地异常：${reason}`);
  }
  // Older painted soil had no planting slots. Keep crop stages and skip occupied ground.
  if (value.version < WORLD_VERSION) {
    value.cells.forEach((line, row) => line.forEach((cell, column) => {
      if (cell.base === 'soil') model.syncFarmSpot(column, row);
    }));
  }
  // Retire the old rectangular generated hills while retaining the new irregular previews.
  model.data.objects = model.data.objects.filter((object) => !(object.type === 'hill' && object.shapeSeed === undefined && object.id.startsWith('generated-hill-')));
  return model.snapshot();
}
