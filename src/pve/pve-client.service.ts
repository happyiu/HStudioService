import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { request as httpsRequest } from 'node:https';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PveClient {
  private readonly baseUrl: URL | null;
  private readonly tokenId: string;
  private readonly tokenSecret: string;
  private readonly ca: Buffer | undefined;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    const rawBaseUrl = config.get<string>('PVE_BASE_URL')?.trim();
    let parsedBaseUrl: URL | null = null;
    if (rawBaseUrl) {
      try {
        const parsed = new URL(rawBaseUrl);
        if (
          parsed.protocol === 'https:'
          && parsed.pathname === '/'
          && !parsed.search
          && !parsed.hash
          && !parsed.username
          && !parsed.password
        ) {
          parsedBaseUrl = parsed;
        }
      } catch {
        parsedBaseUrl = null;
      }
    }
    this.baseUrl = parsedBaseUrl;
    this.tokenId = config.get<string>('PVE_TOKEN_ID')?.trim() || '';
    this.tokenSecret = config.get<string>('PVE_TOKEN_SECRET')?.trim() || '';

    const caPath = config.get<string>('PVE_CA_CERT_PATH')?.trim();
    this.ca = caPath ? readFileSync(resolve(caPath)) : undefined;

    const timeout = Number(config.get<string>('PVE_TIMEOUT_MS'));
    this.timeoutMs = Number.isInteger(timeout) && timeout >= 500 && timeout <= 30000 ? timeout : 5000;
  }

  get isConfigured(): boolean {
    return this.baseUrl !== null && Boolean(this.tokenId && this.tokenSecret);
  }

  get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    if (!this.isConfigured || !this.baseUrl) {
      return Promise.reject(new ServiceUnavailableException('PVE 未配置'));
    }

    const url = new URL(`/api2/json${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

    return new Promise<T>((resolveResponse, reject) => {
      const request = httpsRequest(url, {
        method: 'GET',
        ca: this.ca,
        rejectUnauthorized: true,
        headers: {
          Accept: 'application/json',
          Authorization: `PVEAPIToken=${this.tokenId}=${this.tokenSecret}`,
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > 5 * 1024 * 1024) {
            request.destroy();
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => {
          const status = Number(response.statusCode || 0);
          if (status < 200 || status >= 300) {
            reject(new ServiceUnavailableException(`PVE API 返回 HTTP ${status}`));
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: T };
            if (!Object.prototype.hasOwnProperty.call(body, 'data')) throw new Error('missing_data');
            resolveResponse(body.data as T);
          } catch {
            reject(new ServiceUnavailableException('PVE API 返回无效数据'));
          }
        });
      });

      request.setTimeout(this.timeoutMs, () => request.destroy(new Error('timeout')));
      request.on('error', () => reject(new ServiceUnavailableException('无法连接 PVE API')));
      request.end();
    });
  }
}
