import { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, Package, Clock, HardDrive, RefreshCw } from 'lucide-react';

interface BackupEntry {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  type: string;
}

interface BackupsResponse {
  backups: BackupEntry[];
  total: number;
}

function formatTimeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function BackupsPanel() {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/backups');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: BackupsResponse = await resp.json();
      setBackups(data.backups);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBackups(); }, [fetchBackups]);

  const handleDownload = useCallback((entry: BackupEntry) => {
    window.open(`/api/backups/${encodeURIComponent(entry.name)}`, '_blank');
  }, []);

  const handleDelete = useCallback(async (entry: BackupEntry) => {
    if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
    setDeleting(entry.name);
    try {
      const resp = await fetch(`/api/backups/${encodeURIComponent(entry.name)}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setBackups(prev => prev.filter(b => b.name !== entry.name));
    } catch (err) {
      alert(`Delete failed: ${err}`);
    } finally {
      setDeleting(null);
    }
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="panel-header border-l-[3px] border-l-primary flex items-center justify-between shrink-0">
        <span className="panel-label text-primary">
          <span className="panel-diamond">◆</span>
          BACKUPS
        </span>
        <button
          onClick={fetchBackups}
          disabled={loading}
          className="shell-icon-button h-8 w-8 p-0"
          title="Refresh"
          aria-label="Refresh backups list"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && backups.length === 0 && (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
            Loading backups…
          </div>
        )}

        {error && (
          <div className="px-4 py-3 text-destructive text-xs">
            Error: {error}
          </div>
        )}

        {!loading && backups.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <Package size={24} className="opacity-30" />
            <p className="text-xs">No backups found</p>
            <p className="text-[0.667rem]">Backups appear here after the next scheduled run</p>
          </div>
        )}

        {backups.map((entry) => (
          <div
            key={entry.path}
            className="flex items-center gap-3 px-4 py-3 border-b border-border/40 hover:bg-background/50 transition-colors group"
          >
            {/* Icon */}
            <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <HardDrive size={14} className="text-primary/70" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate text-foreground" title={entry.name}>
                {entry.name}
              </p>
              <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground mt-0.5">
                <span className="flex items-center gap-0.5">
                  <Clock size={9} />
                  {formatTimeAgo(entry.modified)}
                </span>
                <span>·</span>
                <span>{entry.sizeFormatted}</span>
                <span>·</span>
                <span className="text-primary/60">{entry.type}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleDownload(entry)}
                className="shell-icon-button h-7 w-7 p-0"
                title="Download backup"
                aria-label={`Download ${entry.name}`}
              >
                <Download size={11} />
              </button>
              <button
                onClick={() => handleDelete(entry)}
                disabled={deleting === entry.name}
                className="shell-icon-button h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                title="Delete backup"
                aria-label={`Delete ${entry.name}`}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      {backups.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-border/40 text-[0.6rem] text-muted-foreground">
          {backups.length} backup{backups.length !== 1 ? 's' : ''} · automatically maintained
        </div>
      )}
    </div>
  );
}
