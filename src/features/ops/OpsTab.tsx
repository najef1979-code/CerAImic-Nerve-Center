/**
 * OpsTab — System health dashboard
 *
 * Shows: System metrics, Agent sessions, Cron jobs
 * Uses theme-aware CSS variables
 */

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Server, Users, Clock, HardDrive, Cpu, MemoryStick, Activity } from 'lucide-react';
import { useSessionContext } from '@/contexts/SessionContext';
import { ALL_AGENTS, type Agent } from '../org/teams';

interface SystemInfo {
  cpu: {
    manufacturer: string;
    brand: string;
    cores: number;
    physicalCores: number;
    speed: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usedPercent: number;
  };
  disk: {
    fs: string;
    mount: string;
    type: string;
    size: number;
    used: number;
    available: number;
    usedPercent: number;
  }[];
  uptime: {
    system: number;
    gateway: number;
  };
  load: {
    currentLoad: number;
    cpus: { core: number; load: number }[];
  };
}

interface CronJob {
  id: string;
  name?: string;
  enabled?: boolean;
  schedule?: {
    kind: string;
    expr?: string;
    everyMs?: number;
  };
  state?: {
    lastRunAtMs?: number;
    nextRunAtMs?: number;
  };
  agentId?: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)}TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  return `${(bytes / 1e3).toFixed(1)}KB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getAgentStatus(agentId: string, sessions: { sessionKey?: string; key?: string; updatedAt?: number }[]): 'active' | 'recent' | 'idle' | 'offline' {
  const session = sessions.find(s => {
    const key = (s.sessionKey || s.key || '').toLowerCase();
    return key.includes(agentId.toLowerCase());
  });
  
  if (!session) return 'offline';
  
  const now = Date.now();
  const updatedAt = session.updatedAt || now;
  const minutesAgo = (now - updatedAt) / (1000 * 60);
  
  if (minutesAgo <= 5) return 'active';
  if (minutesAgo <= 15) return 'recent';
  return 'idle';
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active': return 'var(--color-green, #22c55e)';
    case 'recent': return 'var(--color-orange, #eab308)';
    case 'idle': return 'var(--color-muted-foreground, #94a3b8)';
    default: return 'var(--color-red, #ef4444)';
  }
}

function getActivityColor(status: string): string {
  switch (status) {
    case 'active': return '#22c55e';
    case 'recent': return '#eab308';
    case 'idle': return '#94a3b8';
    default: return '#ef4444';
  }
}

function getGaugeColor(percent: number): string {
  if (percent > 80) return 'var(--color-red, #ef4444)';
  if (percent > 60) return 'var(--color-orange, #eab308)';
  return 'var(--color-green, #22c55e)';
}

function AgentCard({ agent, status, sessionCount, lastActivity }: {
  agent: Agent;
  status: string;
  sessionCount: number;
  lastActivity?: number;
}) {
  const formatLastSeen = (ts?: number) => {
    if (!ts) return 'Never';
    const date = new Date(ts);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className="rounded-lg px-3 py-1.5 flex items-center justify-between gap-3"
      style={{
        background: 'var(--color-card)',
        border: `1px solid var(--color-border)`,
        boxShadow: 'inset 0 0 0 1px var(--color-border)',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-xs" style={{ color: 'var(--color-foreground)' }}>{agent.name}</span>
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: getActivityColor(status) }}
        />
      </div>
      <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
        <span>{sessionCount} session{sessionCount !== 1 ? 's' : ''}</span>
        <span>{formatLastSeen(lastActivity)}</span>
      </div>
    </div>
  );
}

function SystemSection({ data, loading }: { data: SystemInfo | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" style={{ background: 'var(--color-background)' }}>
        <RefreshCw size={16} className="animate-spin mr-2" style={{ color: 'var(--color-muted-foreground)' }} />
        <span style={{ color: 'var(--color-muted-foreground)' }}>Loading system info...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4" style={{ background: 'var(--color-background)' }}>
        <p style={{ color: 'var(--color-red)' }}>Failed to load system info</p>
      </div>
    );
  }

  const memColor = getGaugeColor(data.memory.usedPercent);
  const loadColor = getGaugeColor(data.load.currentLoad);
  const diskColor = data.disk[0] ? getGaugeColor(data.disk[0].usedPercent) : loadColor;

  return (
    <div className="p-4" style={{ background: 'var(--color-background)' }}>
      <div className="panel-header border-l-[3px] border-l-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-primary" />
          <span className="text-[0.7rem] font-semibold text-primary">System Health</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* CPU */}
        <div className="rounded-lg p-3" style={{ background: 'var(--color-card)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Cpu size={14} style={{ color: 'var(--color-muted-foreground)' }} />
            <span className="text-xs" style={{ color: 'var(--color-muted-foreground)' }}>CPU</span>
          </div>
          <div className="text-sm font-medium" style={{ color: 'var(--color-foreground)' }}>{data.cpu.brand}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted-foreground)' }}>
            {data.cpu.physicalCores} cores @ {data.cpu.speed}GHz
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--color-muted)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${data.load.currentLoad}%`, backgroundColor: loadColor }}
              />
            </div>
            <span className="text-xs font-medium" style={{ color: loadColor }}>
              {data.load.currentLoad}%
            </span>
          </div>
        </div>

        {/* Memory */}
        <div className="rounded-lg p-3" style={{ background: 'var(--color-card)' }}>
          <div className="flex items-center gap-2 mb-2">
            <MemoryStick size={14} style={{ color: 'var(--color-muted-foreground)' }} />
            <span className="text-xs" style={{ color: 'var(--color-muted-foreground)' }}>Memory</span>
          </div>
          <div className="text-sm font-medium" style={{ color: 'var(--color-foreground)' }}>
            {formatBytes(data.memory.used)} / {formatBytes(data.memory.total)}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--color-muted)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${data.memory.usedPercent}%`, backgroundColor: memColor }}
              />
            </div>
            <span className="text-xs font-medium" style={{ color: memColor }}>
              {data.memory.usedPercent}%
            </span>
          </div>
        </div>

        {/* Disk (first one) */}
        <div className="rounded-lg p-3" style={{ background: 'var(--color-card)' }}>
          <div className="flex items-center gap-2 mb-2">
            <HardDrive size={14} style={{ color: 'var(--color-muted-foreground)' }} />
            <span className="text-xs" style={{ color: 'var(--color-muted-foreground)' }}>Disk</span>
          </div>
          {data.disk[0] ? (
            <>
              <div className="text-sm font-medium" style={{ color: 'var(--color-foreground)' }}>
                {formatBytes(data.disk[0].used)} / {formatBytes(data.disk[0].size)}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--color-muted)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${data.disk[0].usedPercent}%`, backgroundColor: diskColor }}
                  />
                </div>
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted-foreground)' }}>
                  {data.disk[0].usedPercent.toFixed(1)}%
                </span>
              </div>
            </>
          ) : (
            <div className="text-xs" style={{ color: 'var(--color-muted-foreground)' }}>No disk info</div>
          )}
        </div>

        {/* Uptime */}
        <div className="rounded-lg p-3" style={{ background: 'var(--color-card)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} style={{ color: 'var(--color-muted-foreground)' }} />
            <span className="text-xs" style={{ color: 'var(--color-muted-foreground)' }}>Uptime</span>
          </div>
          <div className="text-sm font-medium" style={{ color: 'var(--color-foreground)' }}>
            System: {formatUptime(data.uptime.system)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-muted-foreground)' }}>
            Gateway: {formatUptime(data.uptime.gateway)}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentsSection({ sessions, loading }: { sessions: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" style={{ background: 'var(--color-background)' }}>
        <RefreshCw size={16} className="animate-spin mr-2" style={{ color: 'var(--color-muted-foreground)' }} />
        <span style={{ color: 'var(--color-muted-foreground)' }}>Loading sessions...</span>
      </div>
    );
  }

  // Count sessions per agent
  const sessionCounts: Record<string, number> = {};
  sessions.forEach(s => {
    const key = s.sessionKey || s.key || '';
    const match = key.match(/^agent:([^:]+):/);
    if (match) {
      sessionCounts[match[1]] = (sessionCounts[match[1]] || 0) + 1;
    }
  });

  return (
    <div className="px-4" style={{ background: 'var(--color-background)' }}>
      <div className="panel-header border-l-[3px] border-l-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-primary" />
          <span className="text-[0.7rem] font-semibold text-primary">Agents</span>
        </div>
        <span className="text-[0.6rem] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
          {sessions.length} sessions
        </span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
        {ALL_AGENTS.filter(a => a.id !== 'najef').map(agent => {
          const status = getAgentStatus(agent.id, sessions);
          const count = sessionCounts[agent.id] || 0;
          const session = sessions.find(s => (s.sessionKey || s.key || '').includes(agent.id));
          return (
            <AgentCard
              key={agent.id}
              agent={agent}
              status={status}
              sessionCount={count}
              lastActivity={session?.updatedAt}
            />
          );
        })}
      </div>
    </div>
  );
}

function HeartbeatsSection({ sessions, loading }: { sessions: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" style={{ background: 'var(--color-background)' }}>
        <RefreshCw size={16} className="animate-spin mr-2" style={{ color: 'var(--color-muted-foreground)' }} />
        <span style={{ color: 'var(--color-muted-foreground)' }}>Loading heartbeats...</span>
      </div>
    );
  }

  // Get heartbeat info for each agent
  const getHeartbeatInfo = (agentId: string) => {
    const agentSessions = sessions.filter(s => {
      const key = s.sessionKey || s.key || '';
      return key.toLowerCase().includes(agentId.toLowerCase());
    });

    if (agentSessions.length === 0) {
      return { lastSeen: null, status: 'offline', contextTokens: null };
    }

    // Find most recent activity
    let latestActivity = 0;
    let maxContext = 0;
    let isActive = false;

    agentSessions.forEach(s => {
      const updatedAt = s.updatedAt || 0;
      if (updatedAt > latestActivity) latestActivity = updatedAt;
      if (s.contextTokens && s.contextTokens > maxContext) maxContext = s.contextTokens;
      if (s.busy || s.processing) isActive = true;
    });

    const now = Date.now();
    const minutesAgo = (now - latestActivity) / (1000 * 60);

    let status: 'active' | 'recent' | 'idle' | 'offline' = 'offline';
    if (minutesAgo <= 5) status = 'active';
    else if (minutesAgo <= 15) status = 'recent';
    else if (minutesAgo <= 60) status = 'idle';

    return { lastSeen: latestActivity, status, contextTokens: maxContext || null };
  };

  const formatLastSeen = (ts: number | null) => {
    if (!ts) return 'Never';
    const date = new Date(ts);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'var(--color-green)';
      case 'recent': return 'var(--color-orange)';
      case 'idle': return 'var(--color-muted-foreground)';
      default: return 'var(--color-red)';
    }
  };

  const formatContext = (tokens: number | null) => {
    if (!tokens) return null;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}k`;
    return tokens.toString();
  };

  // Get all agents except najef
  const heartbeatAgents = ALL_AGENTS.filter(a => a.id !== 'najef');

  return (
    <div className="px-4" style={{ background: 'var(--color-background)' }}>
      <div className="panel-header border-l-[3px] border-l-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-primary" />
          <span className="text-[0.7rem] font-semibold text-primary">Heartbeats</span>
        </div>
        <span className="text-[0.6rem] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
          {sessions.length} sessions
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
        {heartbeatAgents.map(agent => {
          const info = getHeartbeatInfo(agent.id);
          return (
            <div
              key={agent.id}
              className="rounded-lg px-3 py-1.5 flex items-center justify-between gap-3"
              style={{
                background: 'var(--color-card)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-xs" style={{ color: 'var(--color-foreground)' }}>
                  {agent.name}
                </span>
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: getStatusColor(info.status) }}
                />
              </div>
              <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
                {info.contextTokens && (
                  <span>CTX:{formatContext(info.contextTokens)}</span>
                )}
                <span>{formatLastSeen(info.lastSeen)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CronsSection({ crons, loading }: { crons: CronJob[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" style={{ background: 'var(--color-background)' }}>
        <RefreshCw size={16} className="animate-spin mr-2" style={{ color: 'var(--color-muted-foreground)' }} />
        <span style={{ color: 'var(--color-muted-foreground)' }}>Loading crons...</span>
      </div>
    );
  }

  const formatSchedule = (job: CronJob) => {
    if (job.schedule?.expr) return job.schedule.expr;
    if (job.schedule?.everyMs) {
      const mins = Math.floor(job.schedule.everyMs / 60000);
      return `Every ${mins}m`;
    }
    return 'Unknown';
  };

  const formatLastRun = (job: CronJob) => {
    if (!job.state?.lastRunAtMs) return 'Never';
    const ago = Math.floor((Date.now() - job.state.lastRunAtMs) / 60000);
    if (ago < 1) return 'Just now';
    if (ago < 60) return `${ago}m ago`;
    const hours = Math.floor(ago / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="px-4 pb-4" style={{ background: 'var(--color-background)' }}>
      <div className="panel-header border-l-[3px] border-l-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-primary" />
          <span className="text-[0.7rem] font-semibold text-primary">Scheduled Jobs</span>
        </div>
        <span className="text-[0.6rem] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
          {crons.length} jobs
        </span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
        {crons.map(job => (
          <div
            key={job.id}
            className="rounded-lg px-3 py-1.5 flex items-center justify-between gap-3"
            style={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-xs truncate" style={{ color: 'var(--color-foreground)' }}>
                {job.name || `Cron ${job.id.slice(0, 8)}`}
              </div>
              <div className="text-[10px] truncate" style={{ color: 'var(--color-muted-foreground)' }}>
                {formatSchedule(job)} · {formatLastRun(job)}
              </div>
            </div>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: job.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)',
                color: job.enabled ? 'var(--color-green)' : 'var(--color-muted-foreground)',
              }}
            >
              {job.enabled ? 'Active' : 'Disabled'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OpsTab() {
  const { sessions } = useSessionContext();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sysRes, cronsRes] = await Promise.all([
        fetch('/api/system-info'),
        fetch('/api/crons'),
      ]);
      
      if (sysRes.ok) {
        setSystemInfo(await sysRes.json());
      }
      if (cronsRes.ok) {
        const data = await cronsRes.json();
        // Jobs can be in several places depending on response format
        let jobs: CronJob[] = [];
        
        // Try result.jobs directly
        if (Array.isArray(data.result?.jobs)) {
          jobs = data.result.jobs;
        }
        // Try result.details.jobs
        else if (Array.isArray(data.result?.details?.jobs)) {
          jobs = data.result.details.jobs;
        }
        // Try result.content[0].text which is a JSON string
        else if (typeof data.result?.content?.[0]?.text === 'string') {
          try {
            const parsed = JSON.parse(data.result.content[0].text);
            jobs = parsed.jobs || [];
          } catch {
            jobs = [];
          }
        }
        
        setCrons(jobs);
      }
    } catch (err) {
      console.error('[OpsTab] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: 'var(--color-background)' }}>
      <SystemSection data={systemInfo} loading={loading} />
      <div className="h-2" />
      <AgentsSection sessions={sessions} loading={false} />
      <div className="h-2" />
      <HeartbeatsSection sessions={sessions} loading={false} />
      <div className="h-2" />
      <CronsSection crons={crons} loading={loading} />
    </div>
  );
}
