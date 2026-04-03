/**
 * GET /api/backups — List available backups + status + calendar
 * GET /api/backups/:name — Download a specific backup archive
 * DELETE /api/backups/:name — Delete a specific backup archive
 * GET /api/backups/status — Read/write backup run status JSON
 */

import { Hono } from 'hono';
import { statSync, createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join, basename } from 'node:path';
import { readdirSync, rmSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { CronExpressionParser } from 'cron-parser';

const app = new Hono();

const HOME = process.env.HOME || '/home/najef';
const STATUS_FILE = join(HOME, 'Backups', 'backup-status.json');

// ── Config ──────────────────────────────────────────────────────────────────

function env(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

// Sanitize inputs for shell safety — reject dangerous characters
function sanitizeSSHArg(value: string, name: string): string {
  if (/[;|&$`<>\\"'\x00-\x1f]/.test(value)) {
    throw new Error(`Invalid characters in ${name}`);
  }
  return value;
}

function getBackupDirs(): { name: string; path: string }[] {
  const localDir = env('BACKUP_LOCAL_DIR', '~/Backups').replace('~', HOME);
  return [
    { name: 'Local Backups', path: localDir },
  ];
}

// ── Backup Entry ───────────────────────────────────────────────────────────

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
  return formatSize(bytes);
}

function scanDir(name: string, dirPath: string): BackupEntry[] {
  const entries: BackupEntry[] = [];
  try {
    const files = readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      // Skip nas-sync subdirectory — those are NAS cache files, not local backups
      if (file.name === 'nas-sync') continue;
      if (file.isFile() && (file.name.endsWith('.tar.gz') || file.name.endsWith('.gz') || file.name.endsWith('.zip'))) {
        try {
          const fullPath = join(dirPath, file.name);
          const st = statSync(fullPath);
          entries.push({
            name: file.name,
            path: fullPath,
            size: st.size,
            sizeFormatted: formatSize(st.size),
            modified: st.mtime.toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T'),
            type: name,
          });
        } catch { /* skip unreadable */ }
      } else if (file.isDirectory() && !file.name.startsWith('.')) {
        entries.push(...scanDir(name, join(dirPath, file.name)));
      }
    }
  } catch { /* dir doesn't exist */ }
  return entries;
}

// ── NAS listing ───────────────────────────────────────────────────────────────

interface NasEntry {
  name: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  type: 'full' | 'incremental';
  dayOfWeek: string;
}

function monthNameToNum(monthName: string): string {
  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };
  return months[monthName.toLowerCase()] || '01';
}

function getDayOfWeek(dateStr: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const date = new Date(dateStr + 'T12:00:00');
  return days[date.getDay()];
}

function getNasBackups(): NasEntry[] {
  const entries: NasEntry[] = [];

  // Always scan local NAS cache if it exists
  const cacheDir = join(HOME, 'Backups', 'nas-sync');
  try {
    const files = readdirSync(cacheDir);
    for (const file of files) {
      if (file.endsWith('.tar.gz') || file.endsWith('.gz')) {
        const fullPath = join(cacheDir, file);
        const st = statSync(fullPath);
        // Handle both old format (full-YYYY-MM-DD) and new format (Full-CLI-backup-DD-monthname-YYYY.N)
        const isFull = file.startsWith('full-') || file.startsWith('Full-');
        // Try new format first: Full-CLI-backup-04-april-2026.0 or Incr-CLI-backup-04-april-2026.1
        const newFormatMatch = file.match(/(\d{2})-(\w+)-(\d{4})/);
        const dateStr = newFormatMatch
          ? new Date(`${newFormatMatch[3]}-${monthNameToNum(newFormatMatch[2])}-${newFormatMatch[1].split('-')[0]}`).toISOString().slice(0, 10)
          : st.mtime.toISOString().slice(0, 10);
        entries.push({
          name: file,
          size: st.size,
          sizeFormatted: formatSize(st.size),
          modified: st.mtime.toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T'),
          type: isFull ? 'full' : 'incremental',
          dayOfWeek: getDayOfWeek(dateStr),
        });
      }
    }
  } catch { /* cache dir doesn't exist or empty */ }

  // If NAS is enabled, also try SSH listing for remote files
  const enabled = env('BACKUP_NAS_ENABLED') === 'true';
  if (enabled) {
    const host = env('BACKUP_NAS_HOST');
    const user = env('BACKUP_NAS_USER');
    const remotePath = env('BACKUP_NAS_BACKUP_PATH');
    if (host && user && remotePath) {
      try {
        // Sanitize all SSH arguments to prevent command injection
        const safeHost = sanitizeSSHArg(host, 'BACKUP_NAS_HOST');
        const safeUser = sanitizeSSHArg(user, 'BACKUP_NAS_USER');
        const safePath = sanitizeSSHArg(remotePath, 'BACKUP_NAS_BACKUP_PATH');

        // Use execFileSync with array args instead of shell interpolation
        const output = execFileSync(
          'ssh',
          [
            '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'UserKnownHostsFile=/dev/null',
            `${safeUser}@${safeHost}`,
            'ls', '-la', '--time-style=long-iso', safePath,
          ],
          { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const lines = output.split('\n');
        for (const line of lines) {
          const match = line.match(/^[^-\s][^ ]+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/);
          if (match) {
            const [, sizeStr, date, time, name] = match;
            const size = parseInt(sizeStr, 10);
            if (name.endsWith('.tar.gz') || name.endsWith('.gz') || name.endsWith('.zip')) {
              // Handle both old format (full-YYYY-MM-DD) and new format (Full-CLI-backup-... or Incr-CLI-backup-...)
              const isFull = name.startsWith('full-') || name.startsWith('Full-');
              entries.push({
                name: name.trim(),
                size,
                sizeFormatted: formatSize(size),
                modified: `${date}T${time}:00`,
                type: isFull ? 'full' : 'incremental',
                dayOfWeek: getDayOfWeek(date),
              });
            }
          }
        }
      } catch { /* SSH failed — local cache is still valid */ }
    }
  }

  entries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return entries;
}

// ── Calendar computation ─────────────────────────────────────────────────────

interface CalendarDay {
  date: string;  // YYYY-MM-DD
  local: 'success' | 'failed' | 'missed' | 'none';
  nas: 'success' | 'failed' | 'missed' | 'none';
}

function getCalendar(): { days: CalendarDay[]; missedBackups: string[] } {
  const missed: string[] = [];
  const today = new Date();
  const days: CalendarDay[] = [];

  // Use local timezone (Europe/Amsterdam) for date comparisons
  const localToday = new Date(today.toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam' }));

  const localBackups = scanDir('Local Backups', env('BACKUP_LOCAL_DIR', '~/Backups').replace('~', HOME));
  const nasBackups = getNasBackups();

  for (let i = 13; i >= 0; i--) {
    const d = new Date(localToday);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    const localOnDay = localBackups.filter(e => e.modified.slice(0, 10) === dateStr);
    const nasOnDay = nasBackups.filter(e => e.modified.slice(0, 10) === dateStr);

    const localStatus: CalendarDay['local'] = !env('BACKUP_LOCAL_ENABLED') ? 'none'
      : localOnDay.length > 0 ? 'success'
      : 'none';

    const nasStatus: CalendarDay['nas'] = nasOnDay.length > 0 ? 'success' : 'none';

    // Missed detection for today - consistent with health check
    if (i === 0 && env('BACKUP_LOCAL_ENABLED')) {
      // Check if there's a backup within 24 hours (same logic as isOk)
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const hasRecentBackup = localBackups.some(e => {
        const backupDate = new Date(e.modified);
        return backupDate >= twentyFourHoursAgo;
      });
      const hasRecentNasBackup = nasBackups.some(e => {
        const backupDate = new Date(e.modified);
        return backupDate >= twentyFourHoursAgo;
      });

      // Show missed message if overallHealthy is false (consistent with Issues Detected)
      if (!hasRecentBackup || !hasRecentNasBackup) {
        if (!hasRecentBackup && !hasRecentNasBackup) {
          missed.push(`Local backup missed — no backup found within 24 hours`);
        } else if (!hasRecentBackup) {
          missed.push(`Local backup missed — NAS backup ran but local backup not found within 24 hours`);
        } else if (!hasRecentNasBackup) {
          missed.push(`NAS backup missed — local backup ran but NAS backup not found within 24 hours`);
        }
      }
    }

    days.push({ date: dateStr, local: localStatus, nas: nasStatus });
  }

  return { days, missedBackups: missed };
}

// ── Crontab reading ─────────────────────────────────────────────────────────

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
    if (output.includes('backup-openclaw-native')) entries.push({ time: '01:00 CET', frequency: 'Daily', script: 'backup-openclaw-native.sh', purpose: 'Local backup' });
    if (output.includes('backup-openclaw-to-nas')) entries.push({ time: '01:30 CET', frequency: 'Daily', script: 'backup-openclaw-to-nas.sh', purpose: 'NAS backup' });
    return entries;
  } catch { return []; }
}

// ── Routes ─────────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const dirs = getBackupDirs();
  const allEntries: BackupEntry[] = [];
  for (const dir of dirs) {
    allEntries.push(...scanDir(dir.name, dir.path));
  }
  allEntries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  const nasEntries = getNasBackups();
  nasEntries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  const localEntries = allEntries.filter(e => e.type === 'Local Backups');

  const localSize = localEntries.reduce((sum, e) => sum + e.size, 0);
  const nasSize = nasEntries.reduce((sum, e) => sum + e.size, 0);

  const { days, missedBackups } = getCalendar();

  return c.json({
    local: {
      backupDir: env('BACKUP_LOCAL_DIR', '~/Backups'),
      backups: localEntries,
      totalSpace: formatBytes(localSize),
      count: localEntries.length,
      lastBackup: localEntries[0]?.modified || null,
      type: 'Local',
      purpose: 'Local verified backups',
    },
    nas: {
      backupDir: '~/Backups/nas-sync',
      backups: nasEntries.map(e => ({
        name: e.name,
        size: e.size,
        sizeFormatted: e.sizeFormatted,
        modified: e.modified,
        path: '',
        type: 'NAS Backups',
        backupType: e.type,
        dayOfWeek: e.dayOfWeek,
      })),
      totalSpace: formatBytes(nasSize),
      count: nasEntries.length,
      lastBackup: nasEntries[0]?.modified || null,
      type: 'NAS',
      purpose: 'NAS offsite backup',
    },
    calendar: days,
    missedBackups,
    schedule: getCrontab(),
    backupCount: localEntries.length + nasEntries.length,
    totalSpace: formatBytes(localSize + nasSize),
    hasBackups: localEntries.length > 0 || nasEntries.length > 0,
  });
});

app.get('/status', async (c) => {
  try {
    if (existsSync(STATUS_FILE)) {
      return c.json(JSON.parse(readFileSync(STATUS_FILE, 'utf8')));
    }
  } catch { /* ignore */ }
  return c.json({ local: { runs: [], lastRun: null, lastStatus: null }, nas: { runs: [], lastRun: null, lastStatus: null } });
});

app.get('/:name', async (c) => {
  const name = c.req.param('name');
  const dirs = getBackupDirs();
  for (const dir of dirs) {
    const entries = scanDir(dir.name, dir.path);
    const entry = entries.find(e => e.name === name);
    if (entry) {
      const fileName = basename(entry.path);
      c.header('Content-Disposition', `attachment; filename="${fileName}"`);
      // Set Content-Type based on file extension
      const ext = fileName.toLowerCase();
      if (ext.endsWith('.zip')) {
        c.header('Content-Type', 'application/zip');
      } else if (ext.endsWith('.tar.gz') || ext.endsWith('.gz')) {
        c.header('Content-Type', 'application/gzip');
      } else {
        c.header('Content-Type', 'application/octet-stream');
      }
      // Convert Node ReadStream to Web ReadableStream
      return c.body(Readable.toWeb(createReadStream(entry.path)) as ReadableStream);
    }
  }
  return c.json({ error: 'Backup not found' }, 404);
});

app.delete('/:name', async (c) => {
  const name = c.req.param('name');
  const dirs = getBackupDirs();
  for (const dir of dirs) {
    const entries = scanDir(dir.name, dir.path);
    const entry = entries.find(e => e.name === name);
    if (entry) {
      try { rmSync(entry.path, { force: true }); } catch { /* ignore */ }
      return c.json({ success: true, deleted: name });
    }
  }
  return c.json({ error: 'Backup not found' }, 404);
});

export default app;
