import { BadGatewayException, BadRequestException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type Period = '1d' | '1w' | '1mo' | '30m';
export type AssetType = 'stock' | 'etf';
type Row = Record<string, any>;
export const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const list = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : [];
const number = (value: unknown): number | null => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
export function symbolCode(value: string): string {
  if (typeof value !== 'string' || !/^\d{6}\.(SH|SZ|BJ)$/.test(value)) throw new BadRequestException('标的代码无效');
  return value;
}
function dateValue(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || (!Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)) throw new BadRequestException('日期无效');
  return value;
}
export function validateAnalysis(input: Row) {
  const symbol = symbolCode(input.symbol);
  const assetType: AssetType = input.assetType;
  if (!['stock', 'etf'].includes(assetType)) throw new BadRequestException('资产类型无效');
  const period: Period = input.period || '1d';
  if (!['1d', '1w', '1mo', '30m'].includes(period)) throw new BadRequestException('后端暂不支持该分析周期');
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const end = dateValue(input.end || today);
  const start = dateValue(input.start || new Date(Date.parse(end) - 730 * 86400000).toISOString().slice(0, 10));
  if (start > end || Date.parse(end) - Date.parse(start) > 3660 * 86400000) throw new BadRequestException('分析范围应为顺序日期，最多10年');
  let asOf: string | undefined = input.asOf;
  if (asOf) {
    if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf.replace(' ', 'T') + '+08:00'))) throw new BadRequestException('观察时间应为北京时间');
    dateValue(asOf.slice(0, 10));
    if (asOf.slice(0, 10) < start || asOf.slice(0, 10) > end || asOf.slice(11, 13) > '23' || asOf.slice(14, 16) > '59' || asOf.slice(17) > '59') throw new BadRequestException('观察时间超出范围');
  }
  return { symbol, assetType, period, start, end, asOf };
}
export function normalizeAnalysis(raw: Row, input: ReturnType<typeof validateAnalysis>) {
  if (raw.asset_type && raw.asset_type !== input.assetType) throw new BadGatewayException('上游资产类型不一致');
  const analysis = record(raw.chanlun);
  // Historical analysis uses only the engine's cutoff-normalized bars, never today's raw response.
  const rows = input.asOf ? list(analysis.bars) : list(raw.rows);
  const bars = rows.map((r, i) => ({
    index: i, sourceIndex: r.sourceIndex ?? i, time: String(r.date || ''),
    open: number(r.open), high: number(r.high), low: number(r.low), close: number(r.close),
    volume: number(r.volume), amount: number(r.amount),
    isClosed: r.isClosed ?? r.is_closed ?? false,
    periodStart: r.periodStart ?? r.period_start ?? r.date,
    periodEnd: r.periodEnd ?? r.period_end ?? r.date,
  }));
  if (bars.some((b, i) => !b.time || (i > 0 && b.time <= bars[i - 1].time) || [b.open, b.high, b.low, b.close].some(v => v === null || v <= 0))) throw new BadGatewayException('上游K线格式无效');
  const status = record(raw.data_status);
  return {
    symbol: input.symbol, assetType: input.assetType, name: String(raw.name || input.symbol), period: input.period,
    bars, analysis: Object.keys(analysis).length ? analysis : null,
    source: String(raw.source || 'tick'), adjustment: status.adjustment || 'unknown',
    volumeUnit: raw.volume_unit || status.volume_unit || 'unknown', timeZone: 'Asia/Shanghai',
    fetchedAt: status.fetched_at || null, stale: Boolean(status.stale),
    dataThrough: bars[bars.length - 1]?.time || null, coverageStart: bars[0]?.time || null,
    asOf: input.asOf || null, supportedPeriods: ['1mo', '1w', '1d', '30m'],
  };
}

@Injectable()
export class ChanjingService {
  private readonly pending = new Map<string, Promise<Row>>();
  constructor(private readonly config: ConfigService) {}
  private configValues() {
    const base = this.config.get<string>('TICK_STOCK_API_URL')?.trim();
    const token = this.config.get<string>('TICK_STOCK_API_TOKEN')?.trim();
    if (!base || !token) throw new ServiceUnavailableException('缠境行情服务尚未配置');
    let url: URL;
    try { url = new URL(base); } catch { throw new ServiceUnavailableException('缠境行情服务地址无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ServiceUnavailableException('缠境行情服务地址无效');
    return { base: base.replace(/\/$/, ''), token };
  }
  private upstream(path: string, query: Record<string, string> = {}, method = 'GET', body?: Row): Promise<Row> {
    const { base, token } = this.configValues();
    const url = `${base}${path}${Object.keys(query).length ? '?' + new URLSearchParams(query) : ''}`;
    if (method === 'GET' && this.pending.has(url)) return this.pending.get(url)!;
    const run = async () => {
      const timeout = Number(this.config.get('TICK_STOCK_TIMEOUT_MS') || 30000);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number.isFinite(timeout) ? Math.max(50, Math.min(timeout, 30000)) : 30000);
      try {
        const response = await fetch(url, { method, redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined });
        if (!response.ok) {
          const messages: Record<number, string> = { 401: '行情服务凭证无效，请联系管理员', 403: '行情服务授权不足，请联系管理员', 429: '行情服务请求频繁，请稍后重试' };
          const error = new HttpException(messages[response.status] || '行情服务暂不可用', response.status === 429 ? 429 : 502);
          throw error;
        }
        return record(await response.json());
      } catch (error) {
        if (error instanceof HttpException) throw error;
        throw new BadGatewayException(controller.signal.aborted ? '行情服务请求超时，请重试' : '行情服务连接失败');
      } finally { clearTimeout(timer); }
    };
    const promise = run();
    if (method === 'GET') {
      this.pending.set(url, promise);
      void promise.finally(() => { if (this.pending.get(url) === promise) this.pending.delete(url); }).catch(() => {});
    }
    return promise;
  }
  async search(q: string) {
    if (typeof q !== 'string' || !q.trim() || q.length > 50) throw new BadRequestException('请输入50字以内的名称或代码');
    const data = await this.upstream('/api/kline/instruments/search', { q: q.trim(), asset_types: 'stock,etf', limit: '20' });
    return { items: list(data.results).map(r => ({ symbol: r.symbol, name: r.name, assetType: r.asset_type, code: r.code })) };
  }
  async watchlist() {
    const [data, quotes] = await Promise.all([this.upstream('/api/watchlist'), this.upstream('/api/watchlist/enriched')]);
    const bySymbol = new Map(list(quotes.rows).map(r => [r.symbol, r]));
    return { items: list(data.symbols).filter(r => ['stock', 'etf'].includes(r.asset_type)).map(r => {
      const q = bySymbol.get(r.symbol) || {};
      // Enriched percentages are fractional; do not guess from their magnitude.
      return { symbol: r.symbol, name: r.name || r.symbol, assetType: r.asset_type,
        price: number(q.raw_close ?? q.close), changePercent: number(q.quote_change_pct ?? q.change_pct) === null ? null : Number(q.quote_change_pct ?? q.change_pct) * 100,
        asOf: q.quote_time || q.date || quotes.as_of || null };
    }), shared: true };
  }
  private invalidateWatchlist() {
    for (const key of this.pending.keys()) if (new URL(key).pathname.startsWith('/api/watchlist')) this.pending.delete(key);
  }
  async add(symbol: string) {
    symbolCode(symbol);
    const found = await this.search(symbol);
    if (!found.items.some(item => item.symbol === symbol && ['stock', 'etf'].includes(item.assetType))) throw new BadRequestException('仅支持加入A股或ETF标的');
    await this.upstream('/api/watchlist', {}, 'POST', { symbol: symbolCode(symbol) });
    this.invalidateWatchlist();
    return { ok: true };
  }
  async remove(symbol: string) {
    await this.upstream('/api/watchlist/' + symbolCode(symbol), {}, 'DELETE');
    this.invalidateWatchlist();
    return { ok: true };
  }
  async analysis(query: Row) {
    const input = validateAnalysis(query);
    const params: Record<string, string> = { symbol: input.symbol, start_date: input.start,
      end_date: input.asOf?.slice(0, 10) || input.end, include_chanlun: 'true', chanlun_source: 'stroke' };
    if (input.asOf) params.chanlun_as_of = input.asOf;
    if (input.period !== '1d') params.period = input.period;
    const raw = await this.upstream(input.period === '1d' ? '/api/kline/daily' : '/api/kline/period', params);
    return normalizeAnalysis(raw, input);
  }
}
