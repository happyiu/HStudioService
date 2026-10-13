import { randomFromSeed } from './WorldGenerator.js';

export const HILL_STAIRS = [
  { side: 'bottom', dx: 0, dy: 1, angle: 0, frames: [[64, 65], [75, 76]] },
  { side: 'left', dx: -1, dy: 0, angle: Math.PI / 2, frames: [[99, 100], [101, 102]] },
  { side: 'top', dx: 0, dy: -1, angle: Math.PI, frames: [[103, 104], [105, 106]] },
  { side: 'right', dx: 1, dy: 0, angle: -Math.PI / 2, frames: [[107, 108], [109, 110]] },
];
export const HILL_WALKABLE = [55, 56, 57, 58, 59, 60, 64, 65, 75, 76,
  ...HILL_STAIRS.slice(1).flatMap(({ frames }) => frames.flat())];
const EDGES = [12, 1, 23, 34, 11, 0, 22, 33, 13, 2, 24, 35, 14, 3, 25, 36];
const CORNERS = [[-1, -1, 28], [-1, 1, 27], [1, -1, 17], [1, 1, 16]];
export const HILL_INTERIOR_FRAMES = [55, 56, 57, 58, 59, 60, ...CORNERS.map(([, , frame]) => frame)];

export function hillCliffBounds(frame, tile = 16) {
  if (HILL_WALKABLE.includes(frame)) return [];
  const rect = (x, y, width, height) => ({ x: x * tile / 16, y: y * tile / 16,
    width: width * tile / 16, height: height * tile / 16 });
  const open = EDGES.indexOf(frame);
  if (open > 0) {
    const bounds = [];
    // Edge tiles contain usable grass; only the rim and the front cliff stop feet.
    if (open & 1) bounds.push(rect(0, 0, 16, 2));
    if (open & 2) bounds.push(rect(0, 6, 16, 10));
    if (open & 4) bounds.push(rect(0, 0, 2, 16));
    if (open & 8) bounds.push(rect(14, 0, 2, 16));
    if ((open & 1) && (open & 4)) bounds.push(rect(0, 0, 4, 4));
    if ((open & 1) && (open & 8)) bounds.push(rect(12, 0, 4, 4));
    return bounds;
  }
  if (frame === 16 || frame === 17) return [rect(frame === 16 ? 14 : 0, 6, 2, 10)];
  if (frame === 27 || frame === 28) return [rect(frame === 27 ? 12 : 0, 0, 4, 2)];
  return [rect(0, 0, 16, 16)];
}

export function irregularHill(width, height, seed) {
  const random = randomFromSeed(seed);
  const spans = [];
  // Broad bands keep the outline uneven without leaving single-tile spikes or narrow necks.
  for (let y = 1; y < height - 1; y += 3) {
    const taper = Math.round(Math.abs((y + 1) / (height - 2) * 2 - 1) ** 2 * width * .2);
    const variation = width >= 18 ? 3 : 2;
    const left = 1 + taper + Math.floor(random() * variation);
    const right = width - 2 - taper - Math.floor(random() * variation);
    for (let row = y; row < Math.min(y + 3, height - 1); row += 1) spans[row] = [left, right];
  }
  const has = (x, y) => !!spans[y] && x >= spans[y][0] && x <= spans[y][1];
  return hillShape(width, height, has, random);
}

export function paintedHill(width, height, footprint, column, row, seed, paths = []) {
  const keys = new Set(footprint.map(([x, y]) => `${x - column},${y - row}`));
  const has = (x, y) => keys.has(`${x},${y}`);
  const hill = hillShape(width, height, has, randomFromSeed(seed));
  const occupied = new Set();
  hill.entrances = paths.map((path) => {
    const direction = HILL_STAIRS.find(({ side }) => side === path.side);
    const { dx, dy, frames } = direction;
    const x = path.column - column; const y = path.row - row;
    for (const offset of [0, 1]) {
      const px = x + (dy ? offset : 0); const py = y + (dx ? offset : 0);
      if (!has(px, py) || has(px + dx, py + dy)
        || !HILL_INTERIOR_FRAMES.includes(hill.tiles[py - dy]?.[px - dx])) throw new Error('请先擦除受拼接影响的山丘道路');
      // Open an enclosed concave corner for the stair landing without opening an outer cliff.
      if (hill.tiles[py - dy][px - dx] < 55) hill.tiles[py - dy][px - dx] = 55;
    }
    const startX = Math.min(x, x + dx); const startY = Math.min(y, y + dy);
    frames.forEach((line, sy) => line.forEach((frame, sx) => {
      const px = startX + sx; const py = startY + sy; const key = `${px},${py}`;
      if (!hill.tiles[py] || hill.tiles[py][px] === undefined || occupied.has(key)) throw new Error('山丘道路重叠或超出边界');
      occupied.add(key); hill.tiles[py][px] = frame;
    }));
    return { side: path.side, x, y, dx, dy };
  });
  return hill;
}

function hillShape(width, height, has, random) {
  const tiles = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    if (!has(x, y)) return -1;
    const open = (has(x, y - 1) ? 0 : 1) | (has(x, y + 1) ? 0 : 2)
      | (has(x - 1, y) ? 0 : 4) | (has(x + 1, y) ? 0 : 8);
    if (open) return EDGES[open];
    return CORNERS.find(([dy, dx]) => !has(x + dx, y + dy))?.[2] ?? 55 + Math.floor(random() * 6);
  }));
  return { tiles, entrances: [] };
}

export function createHillAtlas(scene, tile) {
  const source = scene.textures.get('hills').getSourceImage();
  const atlas = scene.textures.createCanvas('hills-autotile', tile * 11, tile * 11);
  atlas.context.drawImage(source, 0, 0);
  const stairs = scene.textures.createCanvas('hill-stairs', tile * 2, tile * 2);
  HILL_STAIRS[0].frames.forEach((line, y) => line.forEach((frame, x) => {
    stairs.context.drawImage(source, frame % 11 * tile, Math.floor(frame / 11) * tile,
      tile, tile, x * tile, y * tile, tile, tile);
  }));
  // Keep the front-facing cliff shoulders in the original tiles, not in rotated stairs.
  const shoulderWidth = tile / 4; const shoulderTop = tile * 3 / 8;
  for (const x of [0, tile * 2 - shoulderWidth]) {
    stairs.context.drawImage(source, x % tile, tile * 5 + shoulderTop, shoulderWidth, tile - shoulderTop,
      x, shoulderTop, shoulderWidth, tile - shoulderTop);
  }
  for (const { angle, frames } of HILL_STAIRS.slice(1)) {
    frames.forEach((line, y) => line.forEach((frame, x) => {
      const context = atlas.context;
      context.save();
      context.beginPath(); context.rect(frame % 11 * tile, Math.floor(frame / 11) * tile, tile, tile); context.clip();
      context.translate(frame % 11 * tile + tile - x * tile, Math.floor(frame / 11) * tile + tile - y * tile);
      context.rotate(angle);
      context.drawImage(stairs.canvas, -tile, -tile);
      context.restore();
    }));
  }
  atlas.refresh(); atlas.setFilter(0);
  scene.textures.remove('hill-stairs');
}
