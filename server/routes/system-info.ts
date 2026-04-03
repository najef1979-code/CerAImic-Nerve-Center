/**
 * GET /api/system-info — System hardware metrics
 *
 * Returns CPU, memory, disk, and uptime information.
 */

import { Hono } from 'hono';
import os from 'node:os';
import * as si from 'systeminformation';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

app.get('/api/system-info', rateLimitGeneral, async (c) => {
  try {
    const [
      cpu,
      mem,
      disk,
      time,
      load,
    ] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.time(),
      si.currentLoad(),
    ]);

    return c.json({
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        usedPercent: Math.round((mem.used / mem.total) * 100),
      },
      disk: disk.map((d) => ({
        fs: d.fs,
        mount: d.mount,
        type: d.type,
        size: d.size,
        used: d.used,
        available: d.available,
        usedPercent: d.use,
      })),
      uptime: {
        system: os.uptime(),
        gateway: time.uptime,
      },
      load: {
        currentLoad: Math.round(load.currentLoad),
        cpus: load.cpus.map((c) => ({
          core: c.core,
          load: Math.round(c.load),
        })),
      },
    });
  } catch (err) {
    console.error('[system-info] error:', (err as Error).message);
    return c.json({ error: 'Failed to collect system info' }, 500);
  }
});

export default app;
