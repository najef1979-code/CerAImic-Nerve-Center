import { useState, useEffect, useCallback } from 'react';
import { HardDrive, RefreshCw, Clock, Trash2, Download, Shield, Server, Archive, AlertTriangle, Check, X, FolderOpen, Calendar, Database } from 'lucide-react';

interface BackupFile {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  type: string;
}

interface CronEntry {
  time: string;
  frequency: string;
  script: string;
  purpose: string;
}

interface BackupSection {
  backupDir: string;
  backups: BackupFile[];
  totalSpace: string;
  count: number;
  lastBackup: string | null;
  type: string;
  purpose: string;
}

interface BackupStatus {
  local: BackupSection;
  memory: BackupSection;
  archive: BackupSection;
  nas: BackupSection;
  schedule: CronEntry[];
  backupCount: number;
  totalSpace: string;
  hasBackups: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(dateStr);
}

type TabId = 'local' | 'memory' | 'archive' | 'nas';

const TAB_META: Record<TabId, { label: string; icon: React.ReactNode; sectionKey: keyof BackupStatus }> = {
  local: { label: 'Local', icon: <Server size={10} />, sectionKey: 'local' },
  memory: { label: 'Memory', icon: <Database size={10} />, sectionKey: 'memory' },
  archive: { label: 'Archive', icon: <Archive size={10} />, sectionKey: 'archive' },
  nas: { label: 'NAS', icon: <HardDrive size={10} />, sectionKey: 'nas' },
};

export function BackupsPanel() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('local');
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const resp = await fetch('/api/backups');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setStatus(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleDownload = useCallback((entry: BackupFile) => {
    window.open(`/api/backups/${encodeURIComponent(entry.name)}`, '_blank');
  }, []);

  const handleDelete = useCallback(async (entry: BackupFile) => {
    if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
    setDeleting(entry.name);
    try {
      const resp = await fetch(`/api/backups/${encodeURIComponent(entry.name)}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      fetchStatus();
    } catch (err) {
      alert(`Delete failed: ${err}`);
    } finally {
      setDeleting(null);
    }
  }, [fetchStatus]);

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const sectionOk = (section: BackupSection) =>
    section.lastBackup ? new Date(section.lastBackup) > dayAgo : false;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentSection = status?.[TAB_META[activeTab].sectionKey] as BackupSection | undefined;
  const currentBackups = currentSection?.backups || [];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="panel-header border-l-[3px] border-l-primary flex items-center justify-between shrink-0">
        <span className="panel-label text-primary">
          <span className="panel-diamond">◆</span>
          BACKUPS
        </span>
        <button onClick={fetchStatus} className="shell-icon-button h-8 w-8 p-0" aria-label="Refresh">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-destructive text-xs border-b border-border/40 flex items-center gap-2">
          <AlertTriangle size={12} />{error}
        </div>
      )}

      {/* Schedule Bar */}
      {status?.schedule && status.schedule.length > 0 && (
        <div className="px-4 py-2 border-b border-border/40 bg-primary/5">
          <div className="flex items-center gap-1 mb-2">
            <Calendar size={10} className="text-primary/60" />
            <span className="text-[0.6rem] text-muted-foreground uppercase tracking-[0.1em]">Schedule</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {status.schedule.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <Clock size={9} className="text-muted-foreground shrink-0" />
                <span className="text-[0.6rem] text-foreground font-medium">{entry.time}</span>
                <span className="text-[0.6rem] text-muted-foreground">·</span>
                <span className="text-[0.6rem] text-muted-foreground">{entry.script}</span>
                <span className="text-[0.6rem] text-muted-foreground">·</span>
                <span className="text-[0.6rem] text-primary/70">{entry.purpose}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Stats - 4 columns */}
      <div className="grid grid-cols-4 gap-2 p-3 border-b border-border/40">
        {(Object.keys(TAB_META) as TabId[]).map((tabId) => {
          const meta = TAB_META[tabId];
          const section = status?.[meta.sectionKey] as BackupSection | undefined;
          const ok = section ? sectionOk(section) : false;
          return (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              className={`flex flex-col items-center gap-1 py-2 rounded-lg transition-colors ${
                activeTab === tabId
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-background/50'
              }`}
            >
              <div className={`shrink-0 ${activeTab === tabId ? 'text-primary' : 'text-muted-foreground'}`}>
                {meta.icon}
              </div>
              <div className="text-[0.6rem] font-medium text-center leading-tight">
                {meta.label}
              </div>
              <div className="text-[0.6rem] text-muted-foreground">
                {section?.count || 0}
              </div>
              {ok ? (
                <Check size={8} className="text-green shrink-0" />
              ) : (
                <X size={8} className="text-destructive shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Section Info Bar */}
      {currentSection && (
        <div className="px-4 py-2 border-b border-border/40 bg-primary/5">
          <div className="flex items-center gap-3 text-[0.6rem] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Clock size={9} />
              {currentSection.lastBackup ? `Last: ${formatRelative(currentSection.lastBackup)}` : 'No backups'}
            </span>
            <span>·</span>
            <span>{currentSection.purpose}</span>
            <span>·</span>
            <span className="text-primary/60">{currentSection.type}</span>
            <span>·</span>
            <span>{currentSection.totalSpace}</span>
          </div>
        </div>
      )}

      {/* File List */}
      <div className="flex-1 overflow-y-auto">
        {currentBackups.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <FolderOpen size={24} className="opacity-30" />
            <p className="text-xs">No backups in this category</p>
          </div>
        )}

        {currentBackups.map((entry) => (
          <div
            key={entry.path}
            className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 hover:bg-background/50 transition-colors group"
          >
            <div className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <HardDrive size={12} className="text-primary/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate text-foreground" title={entry.name}>
                {entry.name}
              </p>
              <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground mt-0.5">
                <span className="flex items-center gap-0.5">
                  <Clock size={9} />
                  {formatRelative(entry.modified)}
                </span>
                <span>·</span>
                <span>{entry.sizeFormatted}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleDownload(entry)}
                className="shell-icon-button h-7 w-7 p-0"
                title="Download"
                aria-label={`Download ${entry.name}`}
              >
                <Download size={11} />
              </button>
              <button
                onClick={() => handleDelete(entry)}
                disabled={deleting === entry.name}
                className="shell-icon-button h-7 w-7 p-0 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                title="Delete"
                aria-label={`Delete ${entry.name}`}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-2 border-t border-border/40 text-[0.6rem] text-muted-foreground flex items-center gap-2">
        <Shield size={9} />
        {status?.hasBackups
          ? `${status.backupCount} backups · ${status.totalSpace} total`
          : 'No backups found — scheduled backups run automatically'}
      </div>
    </div>
  );
}
