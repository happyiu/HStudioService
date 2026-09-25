import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Site } from '../database/entities/site.entity';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { LuckyAdapter } from './lucky.adapter';

@Injectable()
export class LuckyService {
  private syncing = false;

  constructor(
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly adapter: LuckyAdapter,
  ) {}

  async status() {
    return { ...this.adapter.configuration(), siteCount: await this.sites.count() };
  }

  async sync() {
    if (this.syncing) throw new ConflictException('Lucky 同步正在进行中');
    this.syncing = true;
    try {
      const rules = await this.adapter.readRules();
      const existing = await this.sites.find();
      const luckySites = existing.filter((site) => site.luckyRuleId !== null);
      const byRuleId = new Map(luckySites.map((site) => [site.luckyRuleId as string, site] as const));
      const seen = new Set<string>();
      const now = new Date();
      const changedSites: Site[] = [];
      const newSites: Site[] = [];
      let created = 0;
      let updated = 0;
      let nextOrder = existing.reduce((max, site) => Math.max(max, site.sortOrder), -1) + 1;

      for (const rule of rules) {
        seen.add(rule.id);
        const site = byRuleId.get(rule.id);
        if (site) {
          site.sourceName = rule.name;
          site.url = rule.url;
          site.sourceEnabled = rule.enabled;
          site.syncStatus = 'active';
          site.lastSeenAt = now;
          changedSites.push(site);
          updated += 1;
          continue;
        }

        newSites.push(this.sites.create({
          id: randomUUID(),
          luckyRuleId: rule.id,
          sourceName: rule.name,
          url: rule.url,
          sourceEnabled: rule.enabled,
          name: rule.name,
          icon: 'globe',
          category: 'other',
          accessMode: 'public',
          enabled: true,
          favorite: false,
          sortOrder: nextOrder++,
          syncStatus: 'active',
          lastSeenAt: now,
        }));
        created += 1;
      }

      let missing = 0;
      for (const site of luckySites) {
        const luckyRuleId = site.luckyRuleId;
        if (luckyRuleId !== null && !seen.has(luckyRuleId) && site.syncStatus !== 'missing') {
          site.syncStatus = 'missing';
          changedSites.push(site);
          missing += 1;
        }
      }

      await this.sites.save([...changedSites, ...newSites]);
      return { total: rules.length, created, updated, missing };
    } finally {
      this.syncing = false;
    }
  }

  async list() {
    const sites = await this.sites.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    return sites.map((site) => this.publicSite(site));
  }

  async get(id: string) {
    const site = await this.sites.findOneBy({ id });
    if (!site) throw new NotFoundException('站点不存在');
    return this.publicSite(site);
  }

  async create(dto: CreateSiteDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('站点名称不能为空');

    const url = this.validateUrl(dto.url);
    const existing = await this.sites.find();
    const nextOrder = existing.reduce((max, site) => Math.max(max, site.sortOrder), -1) + 1;
    const site = this.sites.create({
      id: randomUUID(),
      luckyRuleId: null,
      sourceName: name,
      url,
      sourceEnabled: true,
      name,
      icon: dto.icon?.trim() || 'globe',
      category: dto.category?.trim() || 'other',
      accessMode: dto.accessMode?.trim() || 'public',
      enabled: dto.enabled ?? true,
      favorite: dto.favorite ?? false,
      sortOrder: dto.order ?? nextOrder,
      syncStatus: 'active',
      lastSeenAt: null,
    });

    return this.publicSite(await this.sites.save(site));
  }

  async update(id: string, dto: UpdateSiteDto) {
    const site = await this.sites.findOneBy({ id });
    if (!site) throw new NotFoundException('站点不存在');

    if (site.luckyRuleId !== null) {
      const fields = Object.entries(dto)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key);
      if (fields.some((field) => field !== 'order')) {
        throw new ForbiddenException('Lucky 来源站点仅允许调整排序');
      }
      if (dto.order === undefined) {
        throw new BadRequestException('请提供排序值 order');
      }
      site.sortOrder = dto.order;
      return this.publicSite(await this.sites.save(site));
    }

    if (dto.name !== undefined) {
      site.name = dto.name.trim();
      if (!site.name) throw new BadRequestException('站点名称不能为空');
      site.sourceName = site.name;
    }
    if (dto.url !== undefined) site.url = this.validateUrl(dto.url);
    if (dto.icon !== undefined) site.icon = dto.icon.trim();
    if (dto.category !== undefined) site.category = dto.category.trim();
    if (dto.accessMode !== undefined) site.accessMode = dto.accessMode.trim();
    if (dto.enabled !== undefined) site.enabled = dto.enabled;
    if (dto.favorite !== undefined) site.favorite = dto.favorite;
    if (dto.order !== undefined) site.sortOrder = dto.order;

    return this.publicSite(await this.sites.save(site));
  }

  async remove(id: string) {
    const site = await this.sites.findOneBy({ id });
    if (!site) throw new NotFoundException('站点不存在');
    if (site.luckyRuleId !== null) {
      throw new ForbiddenException('Lucky 来源站点不允许删除');
    }

    await this.sites.remove(site);
    return { id, deleted: true };
  }

  private validateUrl(value: string): string {
    const url = value.trim();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    } catch {
      throw new BadRequestException('站点 URL 必须是 http 或 https 地址');
    }
    return url;
  }

  private publicSite(site: Site): Record<string, unknown> {
    return {
      id: site.id,
      luckyRuleId: site.luckyRuleId,
      sourceName: site.sourceName,
      url: site.url,
      sourceEnabled: site.sourceEnabled,
      name: site.name,
      icon: site.icon,
      category: site.category,
      accessMode: site.accessMode,
      enabled: site.enabled,
      favorite: site.favorite,
      order: site.sortOrder,
      syncStatus: site.syncStatus,
      lastSeenAt: site.lastSeenAt,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    };
  }
}
