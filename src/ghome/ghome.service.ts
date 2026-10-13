import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, sign } from 'node:crypto';

export type GhomeWeatherKind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm';

export interface GhomeCity {
  id: string;
  name: string;
  country: string;
  province: string;
  district: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

export interface GhomeCurrentWeather {
  condition: string;
  conditionCode: string;
  kind: GhomeWeatherKind;
  temperatureC: number;
  feelsLikeC: number | null;
  humidity: number | null;
  windSpeedMps: number | null;
  updatedAt: string;
  attribution: string;
}

interface QWeatherLocation {
  id?: unknown;
  name?: unknown;
  country?: unknown;
  adm1?: unknown;
  adm2?: unknown;
  lat?: unknown;
  lon?: unknown;
  tz?: unknown;
}

interface QWeatherLocationResponse {
  code?: unknown;
  location?: unknown;
}

interface QWeatherCurrentResponse {
  condition?: { text?: unknown; code?: unknown };
  temperature?: { value?: unknown };
  feelsLike?: { value?: unknown };
  humidity?: unknown;
  wind?: { speed?: { value?: unknown } };
  metadata?: { attributions?: unknown };
}

interface WeatherConfig {
  host: string;
  developerId: string;
  projectId: string;
  credentialId: string;
  privateKey: string;
}

const REQUEST_TIMEOUT_MS = 10000;
const MAX_QUERY_LENGTH = 100;
const WEATHER_ATTRIBUTION = '和风天气';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function finiteNumber(value: unknown): number | null {
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return finiteNumber(value);
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function weatherKind(code: string, condition: string): GhomeWeatherKind {
  const numericCode = Number(code);
  if ([302, 303, 304].includes(numericCode) || condition.includes('雷')) return 'thunderstorm';
  if ((numericCode >= 400 && numericCode < 500) || /雪|冰雹/.test(condition)) return 'snow';
  if ((numericCode >= 300 && numericCode < 400) || /雨|阵雨/.test(condition)) return 'rain';
  if ((numericCode >= 500 && numericCode < 600) || /雾|霾|沙尘/.test(condition)) return 'fog';
  if (/云|阴/.test(condition)) return 'cloudy';
  return 'clear';
}

export function normalizeQWeatherCities(payload: QWeatherLocationResponse): GhomeCity[] {
  if (stringValue(payload.code) !== '200' || !Array.isArray(payload.location)) return [];

  return payload.location.flatMap((entry): GhomeCity[] => {
    const location = asRecord(entry) as QWeatherLocation;
    const id = stringValue(location.id);
    const name = stringValue(location.name);
    const latitude = finiteNumber(location.lat);
    const longitude = finiteNumber(location.lon);
    const timeZone = stringValue(location.tz);
    if (!id || !name || latitude === null || longitude === null || !timeZone) return [];
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];

    return [{
      id,
      name,
      country: stringValue(location.country),
      province: stringValue(location.adm1),
      district: stringValue(location.adm2),
      latitude,
      longitude,
      timeZone,
    }];
  });
}

export function normalizeQWeatherCurrent(
  payload: QWeatherCurrentResponse,
  updatedAt = new Date().toISOString(),
): GhomeCurrentWeather {
  const conditionInfo = asRecord(payload.condition);
  const temperatureInfo = asRecord(payload.temperature);
  const feelsLikeInfo = asRecord(payload.feelsLike);
  const windInfo = asRecord(payload.wind);
  const windSpeedInfo = asRecord(windInfo.speed);
  const condition = stringValue(conditionInfo.text);
  const conditionCode = stringValue(conditionInfo.code);
  const temperatureC = finiteNumber(temperatureInfo.value);
  if (!condition || !conditionCode || temperatureC === null) {
    throw new ServiceUnavailableException('天气服务返回了无效数据');
  }

  return {
    condition,
    conditionCode,
    kind: weatherKind(conditionCode, condition),
    temperatureC,
    feelsLikeC: nullableNumber(feelsLikeInfo.value),
    humidity: nullableNumber(payload.humidity),
    windSpeedMps: nullableNumber(windSpeedInfo.value),
    updatedAt,
    attribution: WEATHER_ATTRIBUTION,
  };
}

@Injectable()
export class GhomeService {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  async searchCities(query: string): Promise<GhomeCity[]> {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery || normalizedQuery.length > MAX_QUERY_LENGTH) {
      throw new BadRequestException('城市搜索词无效');
    }

    const url = this.endpoint('/geo/v2/city/lookup');
    url.searchParams.set('location', normalizedQuery);
    url.searchParams.set('number', '10');
    url.searchParams.set('lang', 'zh');
    const payload = await this.requestJson<QWeatherLocationResponse>(url);
    if (stringValue(payload.code) !== '200') {
      throw new ServiceUnavailableException('城市搜索暂不可用');
    }
    return normalizeQWeatherCities(payload);
  }

  async currentWeather(latitudeInput: string, longitudeInput: string): Promise<GhomeCurrentWeather> {
    const latitude = Number(latitudeInput);
    const longitude = Number(longitudeInput);
    if (
      !latitudeInput?.trim()
      || !longitudeInput?.trim()
      || !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    ) {
      throw new BadRequestException('城市坐标无效');
    }

    const url = this.endpoint(`/weather/v1/current/${latitude}/${longitude}`);
    url.searchParams.set('localTime', 'true');
    url.searchParams.set('lang', 'zh');
    const payload = await this.requestJson<QWeatherCurrentResponse>(url);
    return normalizeQWeatherCurrent(payload);
  }

  private endpoint(path: string): URL {
    const config = this.weatherConfig();
    return new URL(path, config.host);
  }

  private weatherConfig(): WeatherConfig {
    const host = this.config.get<string>('QWEATHER_API_HOST')?.trim() || '';
    const developerId = this.config.get<string>('QWEATHER_DEVELOPER_ID')?.trim() || '';
    const projectId = this.config.get<string>('QWEATHER_PROJECT_ID')?.trim() || '';
    const credentialId = this.config.get<string>('QWEATHER_CREDENTIAL_ID')?.trim() || '';
    const privateKey = this.config.get<string>('QWEATHER_PRIVATE_KEY')?.trim().replace(/\\n/g, '\n') || '';
    if (!host || !developerId || !projectId || !credentialId || !privateKey) {
      throw new ServiceUnavailableException('天气服务未配置');
    }

    let parsedHost: URL;
    try {
      parsedHost = new URL(host);
    } catch {
      throw new ServiceUnavailableException('天气服务配置无效');
    }
    if (parsedHost.protocol !== 'https:' || parsedHost.pathname !== '/' || parsedHost.search || parsedHost.hash) {
      throw new ServiceUnavailableException('天气服务配置无效');
    }

    return { host: parsedHost.origin, developerId, projectId, credentialId, privateKey };
  }

  private createToken(config: WeatherConfig): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > nowSeconds + 60) return this.cachedToken.value;

    const issuedAt = nowSeconds - 30;
    const expiresAt = nowSeconds + 900;
    const header = encodeBase64Url(JSON.stringify({ alg: 'EdDSA', kid: config.credentialId }));
    const payload = encodeBase64Url(JSON.stringify({
      iss: config.developerId,
      sub: config.projectId,
      iat: issuedAt,
      exp: expiresAt,
    }));
    const unsignedToken = `${header}.${payload}`;

    try {
      const privateKey = createPrivateKey(config.privateKey);
      const signature = sign(null, Buffer.from(unsignedToken), privateKey).toString('base64url');
      const value = `${unsignedToken}.${signature}`;
      this.cachedToken = { value, expiresAt };
      return value;
    } catch {
      throw new ServiceUnavailableException('天气服务凭据无效');
    }
  }

  private async requestJson<T extends object>(url: URL): Promise<T> {
    const config = this.weatherConfig();
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.createToken(config)}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('upstream_http_error');
      const payload = await response.json() as T;
      if (
        typeof payload !== 'object'
        || payload === null
        || ('code' in payload && stringValue((payload as { code?: unknown }).code) !== '200')
      ) {
        throw new Error('upstream_data_error');
      }
      return payload;
    } catch {
      throw new ServiceUnavailableException('天气服务暂不可用');
    }
  }
}
