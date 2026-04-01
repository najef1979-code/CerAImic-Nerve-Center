/**
 * GET /api/backups — List available backups
 * GET /api/backups/:name — Download a specific backup archive
 * DELETE /api/backups/:name — Delete a specific backup archive
 */

import { Hono } from 'hono';
import { statSync, readFileSync, unlinkSync, createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { pipeline } from 'node:stream';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/consumers';
import { createWriteStream } from 'node:fs';
import { readdirSync } from 'node:fs';
import { rmSync } from 'node:fs';

const app = new Hono();

// Backup directories to scan (configurable via env)
function getBackupDirs(): { name: string; path: string }[] {
  const memoryBackups = join(process.env.HOME || '/home/najef', '.openclaw', 'workspace', 'memory_backups');
  const archiveDir = join(process.env.HOME || '/home/najef', '.openclaw', 'workspace', '.openclaw-backup-archive');
  return [
    { name: 'Memory Backups', path: memoryBackups },
    { name: 'Full Archive', path: archiveDir },
  ];
}

interface BackupEntry {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  type: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function scanBackupDir(name: string, dirPath: string): BackupEntry[] {
  const entries: BackupEntry[] = [];
  try {
    const files = readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      if (file.isFile() && (file.name.endsWith('.tar.gz') || file.name.endsWith('.gz') || file.name.endsWith('.zip'))) {
        try {
          const fullPath = join(dirPath, file.name);
          const st = statSync(fullPath);
          entries.push({
            name: file.name,
            path: fullPath,
            size: st.size,
            sizeFormatted: formatSize(st.size),
            modified: st.mtime.toISOString(),
            type: name,
          });
        } catch { /* skip unreadable */ }
      } else if (file.isDirectory()) {
        // Recurse into subdirectories
        const subEntries = scanBackupDir(name, join(dirPath, file.name));
        entries.push(...subEntries);
      }
    }
  } catch { /* dir doesn't exist or not readable */ }
  return entries;
}

app.get('/', async (c) => {
  const dirs = getBackupDirs();
  const allEntries: BackupEntry[] = [];
  for (const dir of dirs) {
    const entries = scanBackupDir(dir.name, dir.path);
    allEntries.push(...entries);
  }
  // Sort by modified date, newest first
  allEntries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return c.json({ backups: allEntries, total: allEntries.length });
});

app.get('/:name', async (c) => {
  const name = c.req.param('name');
  const dirs = getBackupDirs();
  for (const dir of dirs) {
    const entries = scanBackupDir(dir.name, dir.path);
    const entry = entries.find(e => e.name === name);
    if (entry) {
      const fileName = basename(entry.path);
      c.header('Content-Disposition', `attachment; filename="${fileName}"`);
      c.header('Content-Type', 'application/gzip');
      return c.body(createReadStream(entry.path));
    }
  }
  return c.json({ error: 'Backup not found' }, 404);
});

app.delete('/:name', async (c) => {
  const name = c.req.param('name');
  const dirs = getBackupDirs();
  for (const dir of dirs) {
    const entries = scanBackupDir(dir.name, dir.path);
    const entry = entries.find(e => e.name === name);
    if (entry) {
      try {
        rmSync(entry.path, { force: true });
        return c.json({ success: true, deleted: name });
      } catch (err) {
        return c.json({ error: 'Failed to delete', details: String(err) }, 500);
      }
    }
  }
  return c.json({ error: 'Backup not found' }, 404);
});

export default app;
