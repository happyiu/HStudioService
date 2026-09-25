import { randomUUID } from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Device } from '../database/entities/device.entity';
import { CreateDeviceDto } from './dto/create-device.dto';

export interface DeviceProbeResult {
  connection: string;
  machineId: string;
  deviceName: string;
  version: string;
  endpointKind: string;
}

interface DeviceResponse {
  [key: string]: unknown;
}

interface DeviceRequestResult {
  status: number;
  data: DeviceResponse;
}

function responseObject(value: unknown): DeviceResponse {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as DeviceResponse;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as DeviceResponse
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function profiles(value: unknown): string[] {
  if (!Array.isArray(value)) return ['default'];
  const result = value.map((profile) => String(profile || '').trim()).filter(Boolean);
  return result.length ? result : ['default'];
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
  ) {}

  async probe(connection: string): Promise<DeviceProbeResult> {
    const origin = this.normalizeOrigin(connection);
    const result = await this.requestDevice(
      `${origin}/api/devices/link-info?_hstudio_probe=${Date.now()}`,
    );

    if (result.status < 200 || result.status >= 300) {
      throw new BadGatewayException('设备地址无法访问，请检查地址和网络');
    }

    const machineId = String(result.data.device_id || '').trim();
    if (!machineId) {
      throw new BadGatewayException('设备地址有效，但没有返回设备信息');
    }

    return {
      connection: origin,
      machineId,
      deviceName: String(result.data.device_name || result.data.name || '').trim(),
      version: String(result.data.hermes_web_ui_version || '').trim(),
      endpointKind: String(result.data.endpoint_kind || '').trim(),
    };
  }

  async connect(userId: string, dto: CreateDeviceDto): Promise<Record<string, unknown>> {
    const origin = this.normalizeOrigin(dto.connection);
    const existing = await this.devices.findOneBy({ userId, connection: origin });
    const machineId = String(dto.machineId || '').trim() || (await this.probe(origin)).machineId;
    const deviceCode = String(dto.deviceCode || existing?.deviceCode || `app_${randomUUID()}`)
      .trim()
      .slice(0, 120);
    const login = await this.requestDevice(`${origin}/api/auth/app-login`, {
      method: 'POST',
      body: {
        device_code: deviceCode,
        device_name: dto.name.trim(),
        device_brand: dto.deviceBrand?.trim() || 'HStudioApp',
        device_model: dto.deviceModel?.trim() || 'Mobile',
        username: dto.username.trim(),
        password: dto.password,
      },
    });

    if (login.status === 401 || login.status === 403) {
      throw new BadRequestException('设备账号或密码不正确');
    }
    if (login.status === 409) {
      throw new BadRequestException('当前设备码已被占用，请稍后重试');
    }
    if (login.status < 200 || login.status >= 300) {
      throw new BadGatewayException('无法登录设备，请检查设备版本和登录信息');
    }

    const token = String(login.data.token || '').trim();
    if (!token) {
      throw new BadGatewayException('设备登录成功，但服务器没有返回 token');
    }

    const device = existing || this.devices.create({
      id: randomUUID(),
      userId,
      connection: origin,
      name: dto.name.trim(),
      machineId,
      deviceCode,
      deviceToken: token,
      profilesJson: JSON.stringify(profiles(login.data.profiles)),
    });
    device.name = dto.name.trim();
    device.machineId = machineId;
    device.deviceCode = deviceCode;
    device.deviceToken = token;
    device.profilesJson = JSON.stringify(profiles(login.data.profiles));

    return this.publicDevice(await this.devices.save(device));
  }

  async list(userId: string): Promise<Record<string, unknown>[]> {
    const devices = await this.devices.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
    return devices.map((device) => this.publicDevice(device));
  }

  async remove(userId: string, id: string): Promise<{ success: boolean }> {
    const device = await this.devices.findOneBy({ id, userId });
    if (!device) throw new NotFoundException('设备不存在');
    await this.devices.remove(device);
    return { success: true };
  }

  private normalizeOrigin(value: string): string {
    try {
      const url = new URL(value.trim());
      if (!(url.protocol === 'http:' || url.protocol === 'https:') || !url.hostname) {
        throw new Error('invalid_device_address');
      }
      return url.origin;
    } catch {
      throw new BadRequestException('请输入完整设备地址，例如 http://192.168.1.10:8748');
    }
  }

  private async requestDevice(
    url: string,
    options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
  ): Promise<DeviceRequestResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let response: Response;

    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new BadGatewayException('设备地址无法访问，请检查地址和网络');
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => '');
    return { status: response.status, data: responseObject(raw) };
  }

  private publicDevice(device: Device): Record<string, unknown> {
    return {
      id: device.id,
      name: device.name,
      connection: device.connection,
      machineId: device.machineId,
      profiles: profiles(device.profilesJson ? JSON.parse(device.profilesJson) : []),
      token: device.deviceToken,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    };
  }
}
