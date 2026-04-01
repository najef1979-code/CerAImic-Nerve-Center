/**
 * GET /api/backups — List available backups + status
 * GET /api/backups/:name — Download a specific backup archive
 * DELETE /api/backups/:name — Delete a specific backup archive
 */

import { Hono } from 'hono';
import { statSync, createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { readdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const app = new Hono();

function getBackupDirs(): { name: string; path: string }[] {
  const home = process.env.HOME || '/home/najef';
  return [
    { name: 'Local Backups', path: join(home, 'Backups') },
    { name: 'Memory Backups', path: join(home, '.openclaw', 'workspace', 'memory_backups') },
    { name: 'Full Archive', path: join(home, '.openclaw', 'workspace', '.openclaw-backup-archive') },
    { name: 'NAS Cache', path: join(home, 'Backups', 'nas-sync') },
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

function formatBytes(bytes: number): string {
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
      } else if (file.isDirectory() && !file.name.startsWith('.')) {
        const subEntries = scanBackupDir(name, join(dirPath, file.name));
        entries.push(...subEntries);
      }
    }
  } catch { /* dir doesn't exist */ }
  return entries;
}

interface CronEntry {
  time: string;
  frequency: string;
  script: string;
  purpose: string;
}

function getCrontab(): CronEntry[] {
  try {
    const output = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
    const entries: CronEntry[] = [];
    if (output.includes('backup-openclaw-native')) {
      entries.push({ time: '01:00 CET', frequency: 'Daily', script: 'backup-openclaw-native.sh', purpose: 'Local verified backup' });
    }
    if (output.includes('backup-openclaw-to-nas')) {
      entries.push({ time: '01:30 CET', frequency: 'Daily', script: 'backup-openclaw-to-nas.sh', purpose: 'Offsite backup to NAS' });
    }
    if (output.includes('backup_memory_to_nas')) {
      entries.push({ time: '02:00 CET', frequency: 'Daily', script: 'backup_memory_to_nas.sh', purpose: 'Memory backups to NAS' });
    }
    if (output.includes('backup-watchdog')) {
      entries.push({ time: 'Every 30min', frequency: 'Watchdog', script: 'backup-watchdog.sh', purpose: 'Watchdog monitoring' });
    }
    return entries;
  } catch { return []; }
}

app.get('/', async (c) => {
  const dirs = getBackupDirs();
  const allEntries: BackupEntry[] = [];
  for (const dir of dirs) {
    const entries = scanBackupDir(dir.name, dir.path);
    allEntries.push(...entries);
  }
  allEntries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  const localFiles = allEntries.filter(b => b.type === 'Local Backups');
  const memoryFiles = allEntries.filter(b => b.type === 'Memory Backups');
  const archiveFiles = allEntries.filter(b => b.type === 'Full Archive');
  const nasFiles = allEntries.filter(b => b.type === 'NAS Cache');
  const totalSize = allEntries.reduce((sum, b) => sum + b.size, 0);

  return c.json({
    backups: allEntries,
    total: allEntries.length,
    local: {
      backupDir: '~/Backups',
      backups: localFiles,
      totalSpace: formatBytes(localFiles.reduce((sum, b) => sum + b.size, 0)),
      count: localFiles.length,
      lastBackup: localFiles[0]?.modified || null,
      type: 'Local',
      purpose: 'Local verified backups',
    },
    memory: {
      backupDir: '~/.openclaw/workspace/memory_backups',
      backups: memoryFiles,
      totalSpace: formatBytes(memoryFiles.reduce((sum, b) => sum + b.size, 0)),
      count: memoryFiles.length,
      lastBackup: memoryFiles[0]?.modified || null,
      type: 'Memory Snapshots',
      purpose: 'Daily memory snapshots',
    },
    archive: {
      backupDir: '~/.openclaw/workspace/.openclaw-backup-archive',
      backups: archiveFiles,
      totalSpace: formatBytes(archiveFiles.reduce((sum, b) => sum + b.size, 0)),
      count: archiveFiles.length,
      lastBackup: archiveFiles[0]?.modified || null,
      type: 'Full Archive',
      purpose: 'Complete OpenClaw state',
    },
    nas: {
      backupDir: '~/Backups/nas-sync',
      backups: nasFiles,
      totalSpace: formatBytes(nasFiles.reduce((sum, b) => sum + b.size, 0)),
      count: nasFiles.length,
      lastBackup: nasFiles[0]?.modified || null,
      type: 'NAS Cache',
      purpose: 'Offsite NAS sync cache',
    },
    schedule: getCrontab(),
    backupCount: allEntries.length,
    totalSpace: formatBytes(totalSize),
    hasBackups: allEntries.length > 0,
  });
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
