export const DEFAULT_GENERATOR = { seed: 'sprout-128', landPercent: 55, positions: [] };

export function validateGeneratorOptions(options) {
  if (!options || typeof options.seed !== 'string' || !options.seed.trim() || options.seed.length > 64) throw new Error('种子请输入 1～64 个字符');
  if (!Number.isInteger(options.landPercent) || options.landPercent < 10 || options.landPercent > 90) throw new Error('陆地比例应为 10%～90%');
  if (options.positions !== undefined && (!Array.isArray(options.positions) || options.positions.length > 4 || new Set(options.positions).size !== options.positions.length || options.positions.some((side) => !['top', 'bottom', 'left', 'right'].includes(side)))) throw new Error('大陆位置无效');
  if (options.position !== undefined && !['top', 'bottom', 'left', 'right', 'center'].includes(options.position)) throw new Error('大陆位置无效');
}

export function mainlandPositions(options) {
  const requested = options?.positions ?? (options?.position && options.position !== 'center' ? [options.position] : []);
  return ['top', 'bottom', 'left', 'right'].filter((side) => requested.includes(side));
}

export function randomFromSeed(seed) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function noiseGrid(columns, rows, spacing, random) {
  const grid = Array.from({ length: Math.ceil(rows / spacing) + 1 }, () =>
    Array.from({ length: Math.ceil(columns / spacing) + 1 }, random));
  const smooth = (x) => x * x * (3 - 2 * x);
  const mix = (a, b, t) => a + (b - a) * t;
  return (column, row) => {
    const x = Math.floor(column / spacing); const y = Math.floor(row / spacing);
    const tx = smooth(column / spacing - x); const ty = smooth(row / spacing - y);
    return mix(mix(grid[y][x], grid[y][x + 1], tx), mix(grid[y + 1][x], grid[y + 1][x + 1], tx), ty);
  };
}

export function hillTiles(width, height) {
  const stairs = Math.floor((width - 2) / 2);
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    if (y === 0) return x === 0 ? 0 : x === width - 1 ? 2 : 1;
    if (y === height - 1) return x === stairs ? 75 : x === stairs + 1 ? 76 : -1;
    if (y === height - 2) return x === 0 ? 22 : x === width - 1 ? 24 : x === stairs ? 64 : x === stairs + 1 ? 65 : 23;
    return x === 0 ? 11 : x === width - 1 ? 13 : 57 + (x + y) % 4;
  }));
}

export function generateWorld(columns, rows, options = DEFAULT_GENERATOR) {
  validateGeneratorOptions(options);
  const generator = { seed: options.seed.trim(), landPercent: options.landPercent, positions: mainlandPositions(options) };
  const random = randomFromSeed(generator.seed);
  const broad = noiseGrid(columns, rows, 28, random);
  const detail = noiseGrid(columns, rows, 11, random);
  const coast = noiseGrid(columns, rows, 5, random);
  const beachDepth = noiseGrid(columns, rows, 12, random);
  const landCount = Math.round(columns * rows * generator.landPercent / 100);
  const { positions } = generator;
  const oceanSidesX = 2 - Number(positions.includes('left')) - Number(positions.includes('right'));
  const oceanSidesY = 2 - Number(positions.includes('top')) - Number(positions.includes('bottom'));
  let oceanMargin = 8;
  while ((columns - oceanMargin * oceanSidesX) * (rows - oceanMargin * oceanSidesY) < landCount) oceanMargin -= 1;
  const ranked = [];
  const cells = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
    const edge = Math.min(positions.includes('left') ? Infinity : column, positions.includes('top') ? Infinity : row,
      positions.includes('right') ? Infinity : columns - 1 - column, positions.includes('bottom') ? Infinity : rows - 1 - row);
    let bias = 0;
    for (const side of positions) {
      const vertical = side === 'top' || side === 'bottom';
      const distance = side === 'top' ? row : side === 'bottom' ? rows - 1 - row : side === 'left' ? column : columns - 1 - column;
      const lateral = vertical ? (column - (columns - 1) / 2) / (columns / 2) : (row - (rows - 1) / 2) / (rows / 2);
      bias += .9 * (1 - distance / (vertical ? rows : columns)) + .35 * Math.exp(-((distance / 6) ** 2) - lateral * lateral * 2);
      // Anchor every selected edge, including opposite edges at low land ratios.
      if (distance < 4 && Math.abs(lateral) < .2) bias += 3;
    }
    if (edge >= oceanMargin) ranked.push({ column, row, score: broad(column, row) * .65 + detail(column, row) * .25 + coast(column, row) * .1 + bias - Math.max(0, oceanMargin + 8 - edge) * .035 });
    return { base: 'water', road: null };
  }));
  ranked.sort((a, b) => b.score - a.score || a.row - b.row || a.column - b.column);
  ranked.slice(0, landCount).forEach(({ column, row }) => { cells[row][column].base = 'grass'; });
  // Only water connected to the map boundary is ocean; enclosed water uses the inland atlas.
  const ocean = Array.from({ length: rows }, () => Array(columns).fill(false));
  const waterQueue = [];
  const flood = (column, row) => {
    if (!cells[row]?.[column] || cells[row][column].base !== 'water' || ocean[row][column]) return;
    ocean[row][column] = true; waterQueue.push({ column, row });
  };
  for (let column = 0; column < columns; column += 1) { flood(column, 0); flood(column, rows - 1); }
  for (let row = 0; row < rows; row += 1) { flood(0, row); flood(columns - 1, row); }
  for (let index = 0; index < waterQueue.length; index += 1) {
    const { column, row } = waterQueue[index];
    flood(column - 1, row); flood(column + 1, row); flood(column, row - 1); flood(column, row + 1);
  }
  cells.forEach((line, row) => line.forEach((cell, column) => {
    if (cell.base === 'water' && !ocean[row][column]) { cell.base = 'grass'; cell.inlandWater = true; }
  }));
  // Each coastal patch spreads sand 1–3 cells inland, without changing the dry-land count.
  const beachQueue = [];
  const remaining = Array.from({ length: rows }, () => Array(columns).fill(0));
  const spread = (column, row, depth) => {
    const cell = cells[row]?.[column];
    if (!cell || cell.base === 'water' || cell.inlandWater || remaining[row][column] >= depth) return;
    remaining[row][column] = depth; cell.base = 'sand'; beachQueue.push({ column, row, depth });
  };
  ranked.slice(0, landCount).forEach(({ column, row }) => {
    let coastal = false;
    for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) {
      if (ocean[row + y]?.[column + x]) coastal = true;
    }
    if (coastal) spread(column, row, 1 + Math.min(2, Math.floor(beachDepth(column, row) * 3)));
  });
  for (let index = 0; index < beachQueue.length; index += 1) {
    const { column, row, depth } = beachQueue[index];
    if (depth <= 1) continue;
    for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) spread(column + x, row + y, depth - 1);
  }
  // Keep actors inside the map even when the mainland reaches an outer edge.
  const spawn = ranked.find(({ column, row }) => column >= 2 && column < columns - 2 && row >= 2 && row < rows - 2
    && cells[row][column].base !== 'water' && !cells[row][column].inlandWater) || ranked[0];
  return { cells, objects: [], crops: [], generator, spawn: { column: spawn.column, row: spawn.row } };
}
