/**
 * Org Positions API
 * 
 * GET  /api/org-positions      — Get saved positions
 * PUT  /api/org-positions      — Save positions
 * GET  /api/org-positions/backups     — List backups
 * POST /api/org-positions/backup      — Create backup
 * GET  /api/org-positions/backup/:f  — Get specific backup
 */

import { Hono } from 'hono';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const app = new Hono();

const POSITIONS_FILE = 'nerve-org-chart-positions.json';
const BACKUP_DIR = 'nerve-org-chart-backups';

function getPositionsPath(): string {
  return join(process.cwd(), POSITIONS_FILE);
}

function getBackupDir(): string {
  const dir = join(process.cwd(), BACKUP_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// GET /api/org-positions — Get saved positions
app.get('/', c => {
  const path = getPositionsPath();
  if (!existsSync(path)) {
    return c.json({});
  }
  try {
    const data = readFileSync(path, 'utf-8');
    return c.json(JSON.parse(data));
  } catch {
    return c.json({});
  }
});

// PUT /api/org-positions — Save positions
app.put('/', async c => {
  try {
    const positions = await c.rejson();
    const path = getPositionsPath();
    writeFileSync(path, JSON.stringify(positions, null, 2), 'utf-8');
    return c.json({ success: true });
  } catch (err) {
    console.error('[OrgPositions] Failed to save:', err);
    return c.json({ error: 'Failed to save' }, 500);
  }
});

// GET /api/org-positions/backups — List backups
app.get('/backups', c => {
  const dir = getBackupDir();
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      filename: f,
      timestamp: f.replace('positions-', '').replace('.json', '').replace(/-/g, ':').replace('T', ' '),
    }))
    .sort((a, b) => b.filename.localeCompare(a.filename));

  return c.json(files);
});

// POST /api/org-positions/backup — Create backup of current positions
app.post('/backup', async c => {
  try {
    const { filename, positions } = await c.req.json();
    const dir = getBackupDir();
    const path = join(dir, filename);
    writeFileSync(path, JSON.stringify(positions, null, 2), 'utf-8');
    return c.json({ success: true });
  } catch (err) {
    console.error('[OrgPositions] Failed to create backup:', err);
    return c.json({ error: 'Failed to create backup' }, 500);
  }
});

// GET /api/org-positions/backup/:filename — Get specific backup
app.get('/backup/:filename', c => {
  const filename = c.req.param('filename');
  const path = join(getBackupDir(), filename);
  
  if (!existsSync(path)) {
    return c.json({ error: 'Backup not found' }, 404);
  }
  
  try {
    const data = readFileSync(path, 'utf-8');
    return c.json(JSON.parse(data));
  } catch {
    return c.json({ error: 'Failed to read backup' }, 500);
  }
});

export default app;
