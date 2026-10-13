const DAY_LENGTH_MS = 24 * 60 * 1000;

export const SEASONS = ['春季', '夏季', '秋季', '冬季'];
export const SEASON_TINTS = [0xfff7e6, 0xfffbef, 0xffefdf, 0xf0f7ff];
export const WEATHER = {
  clear: { label: '晴朗' },
  rain: { label: '小雨' },
  thunder: { label: '雷雨' },
  snow: { label: '飘雪' },
};
const SEASON_WEATHER_WEIGHTS = [
  { clear: 60, rain: 35, thunder: 5 },
  { clear: 65, rain: 15, thunder: 20 },
  { clear: 80, rain: 15, thunder: 5 },
  { clear: 60, snow: 40 },
];
const TIME_LIGHT_POINTS = [
  [0, 0x282149, 0.32], [300, 0x282149, 0.32], [360, 0xffad61, 0.14],
  [480, 0xf5d982, 0.05], [720, 0xffffff, 0], [1020, 0xffbd8b, 0.04],
  [1080, 0xb6573e, 0.12], [1200, 0x42578a, 0.2], [1380, 0x282149, 0.32],
  [1440, 0x282149, 0.32],
];

function lightAtMinute(minute) {
  let index = 0;
  while (index < TIME_LIGHT_POINTS.length - 2 && minute > TIME_LIGHT_POINTS[index + 1][0]) index += 1;
  const [startMinute, startColor, startAlpha] = TIME_LIGHT_POINTS[index];
  const [endMinute, endColor, endAlpha] = TIME_LIGHT_POINTS[index + 1];
  const progress = Math.min(Math.max((minute - startMinute) / (endMinute - startMinute), 0), 1);
  const channels = [16, 8, 0].map((shift) => Math.round(
    ((startColor >> shift) & 0xff) + (((endColor >> shift) & 0xff) - ((startColor >> shift) & 0xff)) * progress,
  ));
  return {
    color: `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`,
    alpha: Number((startAlpha + (endAlpha - startAlpha) * progress).toFixed(3)),
  };
}

export function multiplyTint(base, tint) {
  return [16, 8, 0].reduce((color, shift) => {
    const channel = Math.round(((base >> shift) & 0xff) * ((tint >> shift) & 0xff) / 255);
    return color | (channel << shift);
  }, 0);
}

/** @param {number | null} seasonOverride */
export function getTimeState(startTime, startMinute, now = Date.now(), seasonOverride = null) {
  const elapsed = Math.max(0, now - startTime);
  const totalMinutes = Math.max(0, startMinute + Math.floor(elapsed / DAY_LENGTH_MS * 1440));
  const dayNumber = Math.floor(totalMinutes / 1440) + 1;
  const minute = totalMinutes % 1440;
  const hour = minute / 60;
  const seasonIndex = seasonOverride ?? Math.floor((dayNumber - 1) / 7) % SEASONS.length;
  const phaseLabel = hour >= 5 && hour < 8 ? '清晨'
    : hour >= 8 && hour < 17 ? '白昼'
      : hour >= 17 && hour < 20 ? '黄昏' : '夜晚';
  const light = lightAtMinute(minute);
  return {
    dayNumber,
    seasonIndex,
    minute,
    hour,
    time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
    dayLabel: SEASONS[seasonIndex],
    phaseLabel,
    lightColor: light.color,
    lightAlpha: light.alpha,
  };
}

export function applyEnvironmentSettings(current, settings, now = Date.now()) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('世界设定参数无效');
  const { minute, seasonIndex, weatherKind } = settings;
  if (minute !== undefined && (!Number.isInteger(minute) || minute < 0 || minute >= 1440)) throw new Error('时间须在 00:00 至 23:59 之间');
  if (seasonIndex !== undefined && seasonIndex !== null && (!Number.isInteger(seasonIndex) || seasonIndex < 0 || seasonIndex >= SEASONS.length)) throw new Error('季节参数无效');
  if (weatherKind !== undefined && weatherKind !== null && (typeof weatherKind !== 'string' || !Object.prototype.hasOwnProperty.call(WEATHER, weatherKind))) throw new Error('天气参数无效');
  const state = getTimeState(current.startTime, current.startMinute, now);
  return {
    startMinute: minute === undefined ? current.startMinute : (current.startMinute + minute - state.minute + 1440) % 1440,
    seasonOverride: seasonIndex === undefined ? current.seasonOverride : seasonIndex,
    weatherOverride: weatherKind === undefined ? current.weatherOverride : weatherKind,
  };
}

export function randomWeather(seasonIndex) {
  const choices = Object.entries(SEASON_WEATHER_WEIGHTS[seasonIndex]);
  const roll = Math.random() * 100;
  let accumulated = 0;
  for (const [kind, weight] of choices) {
    accumulated += weight;
    if (roll < accumulated) return kind;
  }
  return 'clear';
}
