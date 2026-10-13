import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GhomeService, normalizeQWeatherCurrent, normalizeQWeatherCities } from './ghome.service';

const { privateKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const configValues: Record<string, string> = {
  QWEATHER_API_HOST: 'https://weather.example.test',
  QWEATHER_DEVELOPER_ID: 'Q123456789',
  QWEATHER_PROJECT_ID: 'PROJECT123',
  QWEATHER_CREDENTIAL_ID: 'CREDENTIAL123',
  QWEATHER_PRIVATE_KEY: privateKeyPem,
};

function createService(values: Record<string, string> = configValues): GhomeService {
  const config = { get: (name: string) => values[name] } as unknown as ConfigService;
  return new GhomeService(config);
}

async function withFetch(mock: typeof fetch, run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('city search maps provider results and sends server-side JWT auth', async () => {
  await withFetch(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/geo/v2/city/lookup');
    assert.equal(url.searchParams.get('location'), '东京');
    assert.match(String(init?.headers && (init.headers as Record<string, string>).Authorization), /^Bearer .+\..+\..+$/);
    return Response.json({
      code: '200',
      location: [{
        id: '101010100', name: 'Tokyo', country: '日本', adm1: 'Tokyo', adm2: '',
        lat: '35.68', lon: '139.69', tz: 'Asia/Tokyo',
      }],
    });
  }, async () => {
    const cities = await createService().searchCities('东京');
    assert.deepEqual(cities, [{
      id: '101010100', name: 'Tokyo', country: '日本', province: 'Tokyo', district: '',
      latitude: 35.68, longitude: 139.69, timeZone: 'Asia/Tokyo',
    }]);
  });
});

test('city normalization drops results missing coordinates or timezone', () => {
  const cities = normalizeQWeatherCities({
    code: '200',
    location: [
      { id: '1', name: 'Beijing', lat: '39.9', lon: '116.4', tz: 'Asia/Shanghai' },
      { id: '2', name: 'Invalid', lat: '999', lon: '0', tz: 'Asia/Shanghai' },
      { id: '3', name: 'No timezone', lat: '1', lon: '2' },
    ],
  });
  assert.equal(cities.length, 1);
  assert.equal(cities[0].id, '1');
});

test('current weather is normalized and classified for scene effects', async () => {
  await withFetch(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/weather/v1/current/35.68/139.69');
    assert.equal(url.searchParams.get('localTime'), 'true');
    assert.ok(init?.headers);
    return Response.json({
      condition: { text: '雷阵雨', code: '302' },
      temperature: { value: '22.5' },
      feelsLike: { value: '23' },
      humidity: 0.8,
      wind: { speed: { value: 3.2 } },
    });
  }, async () => {
    const weather = await createService().currentWeather('35.68', '139.69');
    assert.equal(weather.kind, 'thunderstorm');
    assert.equal(weather.temperatureC, 22.5);
    assert.equal(weather.feelsLikeC, 23);
    assert.equal(weather.attribution, '和风天气');
  });
});

test('weather normalization rejects incomplete upstream data', () => {
  assert.throws(
    () => normalizeQWeatherCurrent({ condition: { text: '', code: '100' }, temperature: { value: 'x' } }),
    ServiceUnavailableException,
  );
});

test('missing QWeather credentials fail without a provider request', async () => {
  await assert.rejects(
    createService({}).searchCities('杭州'),
    ServiceUnavailableException,
  );
});

test('invalid city queries and coordinates are rejected', async () => {
  const service = createService();
  await assert.rejects(service.searchCities(' '), BadRequestException);
  await assert.rejects(service.currentWeather('91', '0'), BadRequestException);
  await assert.rejects(service.currentWeather('0', ''), BadRequestException);
});

test('upstream HTTP failures return a controlled unavailable error', async () => {
  await withFetch(async () => new Response('upstream unavailable', { status: 502 }), async () => {
    await assert.rejects(
      createService().searchCities('杭州'),
      ServiceUnavailableException,
    );
  });
});
