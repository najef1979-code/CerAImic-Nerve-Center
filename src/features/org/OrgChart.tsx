/**
 * OrgChart — ElkJS-powered hierarchical org chart
 *
 * Layout: ElkJS computes positions, SVG renders nodes + edges.
 * Horizontal flow: Najef → Neon → Orion → Sarah → David → Marcus
 * Images: /public/org/agents/<agent-id>.png (optional)
 *
 * Features:
 * - Read-only by default, enter edit mode to drag nodes
 * - Save creates timestamped backup + saves positions
 * - Cancel reverts all changes
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { RefreshCw, Save, X, Pencil } from 'lucide-react';
import { useSessionContext } from '@/contexts/SessionContext';
import { NAJEF, NEON, BMAD_TEAMS, ALL_AGENTS, type Agent } from './teams';

const elk = new ELK();

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

interface SavedPosition {
  x: number;
  y: number;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 120;
const IMAGE_FOLDER = '/org/agents/';
const MIN_DISTANCE = 0;  // No constraint - free placement
const POSITIONS_FILE = 'nerve-org-chart-positions.json';
const BACKUP_DIR = 'nerve-org-chart-backups';

// Hook: subscribe to theme changes
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains('dark'));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    setIsDark(root.classList.contains('dark'));
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function readCssVar(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim() || fallback;
}

function getDistance(pos1: { x: number; y: number }, pos2: { x: number; y: number }): number {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Distance constraint disabled - allowing free placement
function checkDistanceConstraint(
  _nodeId: string,
  _newPos: { x: number; y: number },
  _allPositions: Record<string, SavedPosition>
): { valid: boolean; tooCloseTo: string[] } {
  return { valid: true, tooCloseTo: [] };
}

// Get backup directory (via fetch API to server)
async function getBackupsDir(): Promise<string> {
  return BACKUP_DIR;
}

// Create timestamped backup and save new positions
async function savePositionsToServer(positions: Record<string, SavedPosition>): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFilename = `positions-${timestamp}.json`;

  // First, create a backup of existing positions
  const existingResp = await fetch(`/api/org-positions`);
  if (existingResp.ok) {
    const existing = await existingResp.json();
    if (existing && Object.keys(existing).length > 0) {
      // Save existing as backup
      const backupResp = await fetch(`/api/org-positions/backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: backupFilename, positions: existing }),
      });
      if (!backupResp.ok) {
        console.warn('[OrgChart] Could not create backup, saving anyway');
      }
    }
  }

  // Save new positions
  const resp = await fetch(`/api/org-positions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(positions),
  });

  if (!resp.ok) {
    throw new Error('Failed to save positions');
  }
}

// Load positions from server
async function loadPositionsFromServer(): Promise<Record<string, SavedPosition> | null> {
  try {
    const resp = await fetch(`/api/org-positions`);
    if (resp.ok) {
      return await resp.json();
    }
  } catch {
    // ignore
  }
  return null;
}

// Get list of backups
async function getBackups(): Promise<{ filename: string; timestamp: string }[]> {
  try {
    const resp = await fetch(`/api/org-positions/backups`);
    if (resp.ok) {
      return await resp.json();
    }
  } catch {
    // ignore
  }
  return [];
}

// Restore from specific backup
async function restoreFromBackupServer(filename: string): Promise<Record<string, SavedPosition> | null> {
  try {
    const resp = await fetch(`/api/org-positions/backup/${encodeURIComponent(filename)}`);
    if (resp.ok) {
      return await resp.json();
    }
  } catch {
    // ignore
  }
  return null;
}

type AgentActivityStatus = 'active' | 'recent' | 'idle' | 'offline';

function getAgentStatus(agentId: string, sessions: { sessionKey?: string; key?: string; updatedAt?: number }[]): AgentActivityStatus {
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

function getTeamColor(teamId: string): string {
  return BMAD_TEAMS.find(t => t.id === teamId)?.color || '#6b7280';
}

function getLevelBorderColor(agent: Agent): string {
  const teamColor = getTeamColor(agent.team);
  if (agent.id === 'najef') {
    return 'var(--color-muted-foreground)';
  }
  if (agent.id === 'main') {
    return 'var(--color-info)';
  }
  if (agent.id === 'orion' || agent.id === 'gemini') {
    return 'var(--color-orange)';
  }
  if (agent.level < 4) {
    return `color-mix(in srgb, ${teamColor} 70%, transparent)`;
  }
  return teamColor;
}

interface AgentNodeProps {
  agent: Agent;
  x: number;
  y: number;
  status: 'active' | 'offline';
  editable: boolean;
  isSelected: boolean;
  savedPositions: Record<string, SavedPosition>;
  onPositionChange: (id: string, pos: SavedPosition) => void;
  onNotification: (msg: string) => void;
  onNodeClick: (id: string, event?: React.MouseEvent) => void;
  isDirty: boolean;
  originalPositions: Record<string, SavedPosition>;
}

function AgentNode({
  agent,
  x,
  y,
  status,
  editable,
  isSelected,
  savedPositions,
  onPositionChange,
  onNotification,
  onNodeClick,
  isDirty,
  originalPositions,
}: AgentNodeProps) {
  const imgSrc = `${IMAGE_FOLDER}${agent.id}.png`;
  const [imgError, setImgError] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x, y });
  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const hasImage = !imgError;
  const isDark = useIsDark();

  // Sync position when prop changes
  useEffect(() => {
    if (!isDragging) {
      setPosition({ x, y });
    }
  }, [x, y, isDragging]);

  const borderColor = getLevelBorderColor(agent);
  const cardBg = readCssVar('--color-card', '#faf9f7');
  const textPrimary = readCssVar('--color-foreground', '#1e293b');
  const textSecondary = readCssVar('--color-muted-foreground', '#64748b');
  const avatarBg = readCssVar('--color-muted', '#f1f5f9');
  const statusColor = status === 'active'
    ? '#22c55e'
    : status === 'recent'
      ? '#eab308'
      : readCssVar('--color-muted-foreground', '#94a3b8');
  const baseShadow = '0 1px 4px rgba(0,0,0,0.08)';
  const hoverShadow = '0 4px 12px rgba(0,0,0,0.15)';
  const shadow = hovered && !isDragging
    ? (isDark ? '0 4px 16px rgba(0,0,0,0.5)' : hoverShadow)
    : (isDark ? '0 1px 4px rgba(0,0,0,0.4)' : baseShadow);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!editable) return;
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeX: position.x,
      nodeY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.nodeX + dx,
        y: dragRef.current.nodeY + dy,
      });
    };

    const handleMouseUp = () => {
      if (!dragRef.current) return;
      setIsDragging(false);

      const newPos = { x: position.x, y: position.y };
      const mergedPositions = { ...savedPositions, [agent.id]: newPos };
      const result = checkDistanceConstraint(agent.id, newPos, mergedPositions);

      if (!result.valid) {
        const tooCloseNames = result.tooCloseTo
          .map(id => ALL_AGENTS.find(a => a.id === id)?.name || id)
          .join(', ');
        onNotification(`"${agent.name}" is too close to: ${tooCloseNames}`);
        // Revert to where it was before drag started
        setPosition({ x: dragRef.current.nodeX, y: dragRef.current.nodeY });
      } else {
        onPositionChange(agent.id, newPos);
      }

      dragRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position, agent, savedPositions, onPositionChange, onNotification]);

  return (
    <foreignObject
      x={position.x}
      y={position.y}
      width={NODE_WIDTH}
      height={NODE_HEIGHT}
      style={{ overflow: 'visible' }}
    >
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        style={{
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          borderRadius: 10,
          border: `2px solid ${borderColor}`,
          background: cardBg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          padding: '4px 6px',
          boxSizing: 'border-box',
          cursor: editable ? (isDragging ? 'grabbing' : 'grab') : 'default',
          transition: isDragging ? 'none' : 'transform 150ms ease, box-shadow 150ms ease',
          transform: hovered && !isDragging && editable ? 'translateY(-2px)' : 'translateY(0)',
          boxShadow: shadow,
          opacity: isDragging ? 0.9 : 1,
          outline: isSelected ? '3px solid #3b82f6' : 'none',
          outlineOffset: '2px',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseDown={handleMouseDown}
        onClick={(e) => editable && onNodeClick(agent.id, e)}
      >
        {/* Name badge at top */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: avatarBg,
            borderRadius: 10,
            padding: '2px 6px',
            maxWidth: '100%',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: borderColor,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {agent.name}
          </span>
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: statusColor,
              border: '1px solid rgba(0,0,0,0.1)',
              flexShrink: 0,
              animation: status === 'active' ? 'pulse 2s infinite' : 'none',
            }}
          />
        </div>

        {/* Image in middle */}
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            background: avatarBg,
            flexShrink: 0,
          }}
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt={agent.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={() => setImgError(true)}
            />
          ) : (
            <span style={{ fontSize: 22 }}>{agent.emoji}</span>
          )}
        </div>

        {/* Role at bottom */}
        <span
          style={{
            fontSize: 9,
            color: textPrimary,
            lineHeight: 1.2,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            textAlign: 'center',
          }}
        >
          {agent.role}
        </span>
      </div>
    </foreignObject>
  );
}

export function OrgChart() {
  const { sessions } = useSessionContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ nodes: ElkNode[]; edges: ElkEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  const [savedPositions, setSavedPositions] = useState<Record<string, SavedPosition>>({});
  const [notification, setNotification] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [originalPositions, setOriginalPositions] = useState<Record<string, SavedPosition>>({});
  const [backups, setBackups] = useState<{ filename: string; timestamp: string }[]>([]);
  const [showRestore, setShowRestore] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [alignTargetId, setAlignTargetId] = useState<string | null>(null);
  const isDark = useIsDark();

  // Load saved positions on mount
  useEffect(() => {
    loadPositionsFromServer().then(saved => {
      if (saved) {
        setSavedPositions(saved);
      }
    });
    getBackups().then(setBackups);
  }, []);

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const handlePositionChange = useCallback((id: string, pos: SavedPosition) => {
    setSavedPositions(prev => ({ ...prev, [id]: pos }));
    setIsDirty(true);
  }, []);

  const computeLayout = useCallback(async () => {
    setLoading(true);

    const elkNodes = ALL_AGENTS.map(agent => ({
      id: agent.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }));

    const elkEdges: ElkEdge[] = ALL_AGENTS
      .filter(a => a.reportsTo)
      .map(agent => ({
        id: `${agent.reportsTo}-${agent.id}`,
        sources: [agent.reportsTo!],
        targets: [agent.id],
      }));

    try {
      const result = await elk.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.spacing.nodeNode': '20',
          'elk.layered.spacing.nodeNodeBetweenLayers': '50',  // 25% closer than default 70
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
          'elk.padding': '[top=100, left=100, bottom=100, right=100]',
        },
        children: elkNodes,
        edges: elkEdges,
      });

      let maxX = 0, maxY = 0;
      for (const node of result.children || []) {
        if (node.x !== undefined && node.y !== undefined) {
          maxX = Math.max(maxX, node.x + NODE_WIDTH);
          maxY = Math.max(maxY, node.y + NODE_HEIGHT);
        }
      }

      setSvgSize({ width: maxX + 50, height: maxY + 50 });
      setLayout({ nodes: result.children || [], edges: result.edges || [] });
    } catch (err) {
      console.error('[OrgChart] ElkJS layout error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    computeLayout();
  }, [computeLayout]);

  // Enter edit mode
  const handleEdit = useCallback(() => {
    setOriginalPositions({ ...savedPositions });
    setIsEditing(true);
    showNotification('Edit mode — drag nodes to reposition');
  }, [savedPositions, showNotification]);

  // Cancel and revert
  const handleCancel = useCallback(() => {
    setSavedPositions(originalPositions);
    setIsEditing(false);
    setIsDirty(false);
    showNotification('Changes discarded');
  }, [originalPositions, showNotification]);

  // Save and exit edit mode
  const handleSave = useCallback(async () => {
    try {
      await savePositionsToServer(savedPositions);
      setIsEditing(false);
      setIsDirty(false);
      const newBackups = await getBackups();
      setBackups(newBackups);
      showNotification('Layout saved with backup');
    } catch {
      showNotification('Failed to save — try again');
    }
  }, [savedPositions, showNotification]);

  // Handle node click - add/remove from selection (shift+click or ctrl+click for multi-select)
  const handleNodeClick = useCallback((nodeId: string, event?: React.MouseEvent) => {
    if (!isEditing) return;
    
    const isMultiSelect = event?.shiftKey || event?.ctrlKey || event?.metaKey;
    
    if (selectedNodeIds.length === 1 && selectedNodeIds[0] === nodeId && !isMultiSelect) {
      // Clicking same node - deselect
      setSelectedNodeIds([]);
      showNotification('Selection cleared');
    } else if (isMultiSelect) {
      // Add/remove from selection
      if (selectedNodeIds.includes(nodeId)) {
        setSelectedNodeIds(prev => prev.filter(id => id !== nodeId));
      } else {
        setSelectedNodeIds(prev => [...prev, nodeId]);
      }
      const count = selectedNodeIds.filter(id => id !== nodeId).length + (selectedNodeIds.includes(nodeId) ? 0 : 1);
      showNotification(`${count} agent${count > 1 ? 's' : ''} selected`);
    } else {
      // Single select
      setSelectedNodeIds([nodeId]);
      showNotification(`Selected "${ALL_AGENTS.find(a => a.id === nodeId)?.name}" — shift+click to add more`);
    }
  }, [isEditing, selectedNodeIds, showNotification]);

  // Distribute selected nodes evenly
  const handleDistributeEvenly = useCallback((axis: 'x' | 'y') => {
    if (selectedNodeIds.length < 3) {
      showNotification('Select 3+ agents to distribute evenly');
      return;
    }
    
    // Get current positions of selected nodes
    const positions = selectedNodeIds.map(id => {
      const saved = savedPositions[id];
      const elk = layout?.nodes.find(n => n.id === id);
      return {
        id,
        x: saved?.x ?? elk?.x ?? 0,
        y: saved?.y ?? elk?.y ?? 0,
      };
    });
    
    // Sort by the axis we're distributing on
    positions.sort((a, b) => axis === 'x' ? a.x - b.x : a.y - b.y);
    
    // Get the range (from first to last)
    const first = positions[0];
    const last = positions[positions.length - 1];
    const range = axis === 'x' ? last.x - first.x : last.y - first.y;
    
    // Calculate spacing
    const spacing = positions.length > 1 ? range / (positions.length - 1) : 0;
    
    // Update positions - keep the other axis the same, distribute on selected axis
    setSavedPositions(prev => {
      const updated = { ...prev };
      positions.forEach((pos, index) => {
        updated[pos.id] = axis === 'x'
          ? { x: first.x + spacing * index, y: pos.y }
          : { x: pos.x, y: first.y + spacing * index };
      });
      return updated;
    });
    setIsDirty(true);
    
    const names = positions.map(p => ALL_AGENTS.find(a => a.id === p.id)?.name).join(', ');
    showNotification(`Distributed: ${names}`);
    setSelectedNodeIds([]);
  }, [selectedNodeIds, savedPositions, layout, showNotification]);

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedNodeIds([]);
    setAlignTargetId(null);
  }, []);

  // Restore from a specific backup
  const handleRestore = useCallback(async (filename: string) => {
    const positions = await restoreFromBackupServer(filename);
    if (positions) {
      setSavedPositions(positions);
      if (!isEditing) {
        showNotification(`Restored: ${filename}`);
      }
      setShowRestore(false);
    } else {
      showNotification('Failed to restore backup');
    }
  }, [isEditing, showNotification]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <RefreshCw size={16} className="animate-spin" />
        <span className="text-xs">Computing layout...</span>
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        Failed to compute layout
      </div>
    );
  }

  const { nodes, edges } = layout;
  const bgColor = readCssVar('--color-background', '#f8fafc');
  const edgeColor = readCssVar('--color-border', '#94a3b8');

  const getNodePosition = (nodeId: string, elkPos: { x?: number; y?: number }) => {
    if (savedPositions[nodeId]) {
      return savedPositions[nodeId];
    }
    return { x: elkPos.x || 0, y: elkPos.y || 0 };
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-auto"
      style={{ minHeight: '100%', background: bgColor }}
    >
      {/* Control buttons */}
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        {!isEditing ? (
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] hover:bg-[var(--color-muted)] transition-colors shadow-sm"
          >
            <Pencil size={12} />
            Edit Layout
          </button>
        ) : (
          <>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-[var(--color-muted)] disabled:text-[var(--color-muted-foreground)] text-white transition-colors shadow-sm"
            >
              <Save size={12} />
              Save
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] hover:bg-[var(--color-muted)] transition-colors shadow-sm"
            >
              <X size={12} />
              Cancel
            </button>
          </>
        )}
        {backups.length > 0 && (
          <button
            onClick={() => setShowRestore(!showRestore)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] hover:bg-[var(--color-muted)] transition-colors shadow-sm"
          >
            Restore Backup ({backups.length})
          </button>
        )}
      </div>

      {/* Restore dropdown */}
      {showRestore && backups.length > 0 && (
        <div className="absolute top-4 right-64 z-20 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg p-2 max-h-64 overflow-auto">
          <div className="text-xs font-medium mb-2 text-[var(--color-muted-foreground)]">Select a backup to restore:</div>
          {backups.map(backup => (
            <button
              key={backup.filename}
              onClick={() => handleRestore(backup.filename)}
              className="block w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-muted)] rounded transition-colors"
            >
              {backup.timestamp}
            </button>
          ))}
        </div>
      )}

      {/* Notification toast */}
      {notification && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg bg-amber-500/90 text-black text-sm font-medium shadow-lg">
          {notification}
        </div>
      )}

      {/* Selection popup - shown when 2+ nodes selected */}
      {selectedNodeIds.length >= 2 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-xl p-4 min-w-72">
          <div className="text-sm font-medium mb-2 text-center">
            {selectedNodeIds.length} agents selected
          </div>
          <div className="text-xs text-center text-[var(--color-muted-foreground)] mb-3">
            {selectedNodeIds.map(id => ALL_AGENTS.find(a => a.id === id)?.name).join(', ')}
          </div>
          {selectedNodeIds.length >= 3 ? (
            <>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => handleDistributeEvenly('x')}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-blue-500 hover:bg-blue-400 text-white transition-colors"
                >
                  Distribute Horizontally
                </button>
                <button
                  onClick={() => handleDistributeEvenly('y')}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-green-500 hover:bg-green-400 text-white transition-colors"
                >
                  Distribute Vertically
                </button>
              </div>
              <button
                onClick={handleClearSelection}
                className="w-full px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-muted)] hover:bg-[var(--color-muted-foreground)]/20 text-[var(--color-foreground)] transition-colors"
              >
                Clear Selection
              </button>
            </>
          ) : (
            <button
              onClick={handleClearSelection}
              className="w-full px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-muted)] hover:bg-[var(--color-muted-foreground)]/20 text-[var(--color-foreground)] transition-colors"
            >
              Clear (need 3+ to distribute)
            </button>
          )}
        </div>
      )}

      {/* Edit mode indicator */}
      {isEditing && !alignTargetId && (
        <div className="absolute top-4 left-4 z-10 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500/90 text-white shadow-sm">
          Editing Mode — Drag, click, or shift+click to multi-select
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>

      {/* Grid background - visible in edit mode */}
      {isEditing && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, var(--color-border) 1px, transparent 1px),
              linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)
            `,
            backgroundSize: '20px 20px',
            backgroundPosition: '-1px -1px',
            opacity: 0.3,
          }}
        />
      )}

      <svg
        width={svgSize.width}
        height={svgSize.height}
        style={{ display: 'block', minWidth: '100%', minHeight: '100%', position: 'relative', zIndex: 1 }}
      >
        {/* Arrow marker */}
        <defs>
          <marker
            id="org-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor} />
          </marker>
        </defs>

        {edges.map(edge => {
          const sourceNode = nodes.find(n => n.id === edge.sources[0]);
          const targetNode = nodes.find(n => n.id === edge.targets[0]);
          if (!sourceNode || !targetNode) return null;

          const sourcePos = getNodePosition(edge.sources[0], sourceNode);
          const targetPos = getNodePosition(edge.targets[0], targetNode);

          // Orthogonal org chart routing
          // Source: bottom center, Target: top center
          // Line goes down from source, then horizontal, then down to target
          const sourceX = sourcePos.x + NODE_WIDTH / 2;
          const sourceY = sourcePos.y + NODE_HEIGHT;
          const targetX = targetPos.x + NODE_WIDTH / 2;
          const targetY = targetPos.y;

          // Vertical drop distance before horizontal turn
          const dropY = Math.min(30, Math.abs(targetY - sourceY) / 2);

          // Build orthogonal path: down, right-angle bend, horizontal, right-angle bend, down
          const path = `M ${sourceX} ${sourceY} L ${sourceX} ${sourceY + dropY} L ${targetX} ${sourceY + dropY} L ${targetX} ${targetY}`;

          return (
            <g key={edge.id}>
              <path
                d={path}
                fill="none"
                stroke={edgeColor}
                strokeWidth={2}
                markerEnd="url(#org-arrow)"
              />
            </g>
          );
        })}

        {nodes.map(node => {
          const agent = ALL_AGENTS.find(a => a.id === node.id);
          if (!agent) return null;

          const status = getAgentStatus(agent.id, sessions);
          const pos = getNodePosition(node.id, node);

          return (
            <AgentNode
              key={agent.id}
              agent={agent}
              x={pos.x}
              y={pos.y}
              status={status}
              editable={isEditing}
              isSelected={selectedNodeIds.includes(agent.id)}
              savedPositions={savedPositions}
              onPositionChange={handlePositionChange}
              onNotification={showNotification}
              onNodeClick={handleNodeClick}
              isDirty={isDirty}
              originalPositions={originalPositions}
            />
          );
        })}
      </svg>
    </div>
  );
}
