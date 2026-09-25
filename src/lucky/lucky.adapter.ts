import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LuckyRule {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function textValue(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function findRuleList(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (depth > 4) return null;

  const object = objectValue(value);
  if (!object) return null;
  for (const key of ['rules', 'items', 'list', 'records', 'results', 'data']) {
    const nested = findRuleList(object[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function normalizeUrl(value: string): string {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('站点地址必须使用 HTTP 或 HTTPS');
  }
  return url.toString();
}

function ruleEnabled(rule: JsonObject): boolean {
  const value = rule.enabled ?? rule.Enable ?? rule.enable ?? rule.is_enabled ?? rule.status;
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return !['0', 'false', 'disabled', 'disable', 'off', 'down'].includes(String(value).trim().toLowerCase());
}

function listenUrl(rule: JsonObject, domain: string): string {
  const protocol = rule.EnableTLS ? 'https' : 'http';
  const sourcePort = Number(rule.ListenPort);
  const port = sourcePort === 16666 ? 9803 : sourcePort;
  const defaultPort = (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80);
  const portSuffix = Number.isInteger(port) && port > 0 && !defaultPort ? `:${port}` : '';
  return normalizeUrl(`${protocol}://${domain}${portSuffix}`);
}

function normalizeFnOsRules(payload: JsonObject): LuckyRule[] | null {
  if (!Array.isArray(payload.ruleList)) return null;

  const result: LuckyRule[] = [];
  for (const ruleValue of payload.ruleList) {
    const rule = objectValue(ruleValue);
    if (!rule || !Array.isArray(rule.ProxyList)) continue;

    for (const proxyValue of rule.ProxyList) {
      const proxy = objectValue(proxyValue);
      if (!proxy || String(proxy.WebServiceType || '').toLowerCase() !== 'reverseproxy') continue;
      const domains = Array.isArray(proxy.Domains) ? proxy.Domains : [];
      for (const domainValue of domains) {
        const domain = textValue(domainValue);
        if (!domain) continue;
        const proxyKey = textValue(proxy.Key, proxy.RuleKey, domain);
        const ruleKey = textValue(rule.RuleKey, rule.key, 'rule');
        result.push({
          id: `${ruleKey}:${proxyKey}:${domain}`,
          name: textValue(proxy.Remark, rule.RuleName, domain),
          url: listenUrl(rule, domain),
          enabled: ruleEnabled(rule) && ruleEnabled(proxy),
        });
      }
    }
  }
  return result;
}

function uniqueRules(rules: LuckyRule[]): LuckyRule[] {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`Lucky 返回重复规则 ID：${rule.id}`);
    seen.add(rule.id);
  }
  return rules;
}

export function normalizeLuckyRules(payload: unknown): LuckyRule[] {
  const payloadObject = objectValue(payload);
  const fnOsRules = payloadObject ? normalizeFnOsRules(payloadObject) : null;
  if (fnOsRules) return uniqueRules(fnOsRules);

  const list = findRuleList(payload);
  if (!list) throw new Error('Lucky 规则响应格式未识别');

  return uniqueRules(list.map((value, index) => {
    const rule = objectValue(value);
    if (!rule) throw new Error(`Lucky 第 ${index + 1} 条规则不是对象`);

    const id = textValue(rule.id, rule.rule_id, rule.ruleId, rule.uuid, rule.key);
    const rawUrl = textValue(
      rule.url,
      rule.public_url,
      rule.publicUrl,
      rule.domain,
      rule.host,
      rule.hostname,
    );
    if (!id || !rawUrl) throw new Error(`Lucky 第 ${index + 1} 条规则缺少 ID 或访问地址`);

    const url = normalizeUrl(rawUrl);
    return {
      id,
      name: textValue(rule.name, rule.title, rule.remark) || new URL(url).hostname,
      url,
      enabled: ruleEnabled(rule),
    };
  }));
}

@Injectable()
export class LuckyAdapter {
  constructor(private readonly config: ConfigService) {}

  configuration() {
    const baseUrl = this.getBaseUrl();
    const rulesPath = this.getRulesPath();
    const token = this.config.get<string>('LUCKY_TOKEN')?.trim() || '';
    return {
      configured: Boolean(baseUrl && rulesPath && token),
      baseUrl: baseUrl || null,
      rulesPath: rulesPath || null,
      hasToken: Boolean(token),
    };
  }

  async readRules(): Promise<LuckyRule[]> {
    const baseUrl = this.getBaseUrl();
    const rulesPath = this.getRulesPath();
    const token = this.config.get<string>('LUCKY_TOKEN')?.trim() || '';
    if (!baseUrl || !rulesPath || !token) {
      throw new BadRequestException('请先配置 LUCKY_BASE_URL（或 LUCKY_URL）和 LUCKY_TOKEN');
    }

    let url: string;
    try {
      const base = new URL(baseUrl);
      if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('invalid_protocol');
      url = new URL(rulesPath.replace(/^\/+/, ''), `${base.toString().replace(/\/$/, '')}/`).toString();
    } catch {
      throw new BadRequestException('Lucky 地址或规则路径无效');
    }

    const headerName = this.config.get<string>('LUCKY_TOKEN_HEADER')?.trim() || 'openToken';
    const configuredPrefix = this.config.get<string>('LUCKY_TOKEN_PREFIX');
    const prefix = configuredPrefix === undefined
      ? ''
      : configuredPrefix && !configuredPrefix.endsWith(' ')
        ? `${configuredPrefix} `
        : configuredPrefix;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', [headerName]: `${prefix}${token}` },
        signal: controller.signal,
      });
    } catch {
      throw new BadGatewayException('Lucky 接口无法访问，请检查地址和网络');
    } finally {
      clearTimeout(timer);
    }

    const body = await response.text().catch(() => '');
    if (!response.ok) throw new BadGatewayException(`Lucky 接口返回 HTTP ${response.status}`);

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new BadGatewayException('Lucky 接口没有返回有效 JSON');
    }

    const payloadObject = objectValue(payload);
    if (payloadObject && Number(payloadObject.ret) < 0) {
      throw new BadGatewayException(`Lucky 接口返回错误：${textValue(payloadObject.msg) || '请求失败'}`);
    }

    try {
      return normalizeLuckyRules(payload);
    } catch (error) {
      throw new BadGatewayException(error instanceof Error ? error.message : 'Lucky 规则响应格式无效');
    }
  }

  private getBaseUrl(): string {
    return this.config.get<string>('LUCKY_BASE_URL')?.trim()
      || this.config.get<string>('LUCKY_URL')?.trim()
      || '';
  }

  private getRulesPath(): string {
    return this.config.get<string>('LUCKY_RULES_PATH')?.trim() || '/api/webservice/rules';
  }
}
