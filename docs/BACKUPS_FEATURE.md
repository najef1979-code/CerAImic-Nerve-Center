# Backups Feature — Architecture & Documentation

## Overview

The Backups feature in CerAImic-Nerve-Center provides visibility and management of all OpenClaw backup types. It is designed to mirror Nerve's native patterns: all configuration lives in `.env`, all paths are configurable, and no values are hardcoded.

## Backup Types

### 1. Local Backup (1x)
**Purpose:** Creates a verified, restorable tar.gz archive of the entire OpenClaw workspace.

**What it backs up:**
- `~/.openclaw/` — workspace, agents, memory, config
- `~/.openclaw/agents/` — all agent directories
- `~/.openclaw/workspace/` — projects and files

**How it works:**
```
openclaw backup create --output "$BACKUP_LOCAL_DIR" --verify
```
- Creates timestamped archive: `YYYY-MM-DDTHH-MM-SS.ZZ-openclaw-backup.tar.gz`
- `--verify` flag runs integrity check on the archive
- Retention: 7 days rolling window (old backups auto-deleted)

**Config env vars:**
```
BACKUP_LOCAL_ENABLED=true           # Enable/disable local backups
BACKUP_LOCAL_DIR=~/Backups          # Local backup destination
BACKUP_RETENTION_DAYS=7            # Days to keep local backups
BACKUP_LOCAL_SCHEDULE="0 1 * * *" # Cron: 01:00 CET daily
```

**Crontab entry:**
```
0 1 * * * /home/najef/.openclaw/workspace/scripts/backup-openclaw-native.sh >> /home/najef/Backups/backup.log 2>&1
```

---

### 2. NAS Backup (Optional)
**Purpose:** Off-site backup to a Network-Attached Storage device for disaster recovery.

**What it backs up:**
- Same archive as local backup
- Synced to NAS via rsync over SSH

**How it works:**
```
rsync -avz --delete "$BACKUP_LOCAL_DIR/" nas:/path/to/backups/
```
- Runs after local backup completes successfully
- Uses SSH key-based authentication
- NAS path configurable per env var

**Config env vars:**
```
BACKUP_NAS_ENABLED=false           # Enable/disable NAS backup
BACKUP_NAS_HOST=                   # NAS hostname or IP
BACKUP_NAS_USER=                   # SSH user
BACKUP_NAS_PATH=                   # Absolute path on NAS
BACKUP_NAS_RETENTION_DAYS=30      # Days to keep NAS backups
```

**Crontab entry:**
```
30 1 * * * /home/najef/.openclaw/workspace/scripts/backup-openclaw-to-nas.sh >> /home/najef/Backups/backup-nas.log 2>&1
```

**NAS status detection:**
- Checks SSH connectivity on startup
- Reports "connected" / "disconnected" / "empty" status
- Gracefully skips if NAS is unreachable

---

### 3. GitHub Backup (Optional)
**Purpose:** Backs up workspace config and key files to a GitHub repository as a versioned archive.

**What it backs up:**
- OpenClaw config files (non-sensitive)
- Agent memory snapshots
- Workspace metadata
- Backup manifest with timestamps

**How it works:**
```
git add . && git commit -m "Backup $(date -u +"%Y-%m-%dT%H-%M-%S.ZNZ")"
git push origin main
```
- Uses GitHub token for authentication
- Creates a signed commit with backup metadata
- Can push to multiple repos

**Config env vars:**
```
BACKUP_GITHUB_ENABLED=false            # Enable/disable GitHub backup
BACKUP_GITHUB_REPO=                     # repo: owner/name
BACKUP_GITHUB_TOKEN=                   # GitHub PAT (stored in env, never logged)
BACKUP_GITHUB_BRANCH=main              # Target branch
BACKUP_GITHUB_PATH=backups/           # Path within repo
BACKUP_GITHUB_SCHEDULE="0 3 * * *"    # Cron: 03:00 CET daily
```

---

## Integration Points

### API Routes
- `GET /api/backups` — Returns all backup sections (local, memory, archive, nas) with schedule info
- `GET /api/backups/:name` — Downloads a specific backup archive
- `DELETE /api/backups/:name` — Deletes a specific backup archive

### Settings UI
- `BackupsSettings` component in `src/features/settings/BackupsSettings.tsx`
- Integrated into `SettingsDrawer` as a settings category
- Reads/writes backup env vars via the settings save mechanism

### Server
- `server/routes/backups.ts` — API endpoints
- `server/lib/config.ts` — Reads backup config from env vars

### Crontab
- Managed by the backup scripts themselves
- Listed in the BackupsPanel UI schedule section

---

## Configuration Flow

```
.env (env vars)
    ↓
server/lib/config.ts (reads process.env)
    ↓
server/routes/backups.ts (uses config)
    ↓
BackupsSettings.tsx (UI → env save)
BackupsPanel.tsx (reads API → displays)
```

---

## Retention Rules

| Backup Type | Default | Config Var |
|---|---|---|
| Local | 7 days | `BACKUP_RETENTION_DAYS` |
| NAS | 30 days | `BACKUP_NAS_RETENTION_DAYS` |
| Memory | 7 days | (follows local) |
| Archive | 30 days | (follows NAS) |
| GitHub | All | (versioned, no pruning) |

---

## Status Indicators

Each backup type shows a status in the BackupsPanel:
- **Green check (✓):** Backup exists and is less than 24 hours old
- **Red X (✗):** No backup found OR backup is older than 24 hours

The 24-hour threshold is based on daily scheduled backups.

---

## Dependencies

- `openclaw` CLI — used by `backup-openclaw-native.sh`
- `rsync` + SSH — used by NAS sync script
- `git` + `gh` CLI — used by GitHub backup script
- `tar` — archive creation
