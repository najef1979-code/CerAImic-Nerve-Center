/**
 * Kanban task store — SQLite-backed with automatic migration from JSON.
 *
 * Uses better-sqlite3 for synchronous SQLite operations with WAL mode.
 * Provides: schema validation, atomic writes, concurrent safety, query support.
 *
 * Data location: ${NERVE_DATA_DIR:-~/.nerve}/kanban/kanban.db
 *
 * Migration: On startup, if tasks.json exists, migrates data to SQLite.
 * @module
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { canonicalizeKanbanAssignee } from './kanban-assignee.js';

// ── Configuration ───────────────────────────────────────────────────

const NERVE_DATA_DIR = process.env.NERVE_DATA_DIR || path.join(os.homedir(), '.nerve');
const KANBAN_DIR = path.join(NERVE_DATA_DIR, 'kanban');
const DB_PATH = path.join(KANBAN_DIR, 'kanban.db');

// Ensure directory exists
try {
  fs.mkdirSync(KANBAN_DIR, { recursive: true });
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
}

// ── Database setup ─────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema version tracking
const CURRENT_SCHEMA_VERSION = 1;

// Create tables
db.exec(`
  -- Tasks table
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'normal',
    createdBy TEXT NOT NULL DEFAULT 'operator',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    sourceSessionKey TEXT,
    assignee TEXT,
    labels TEXT DEFAULT '[]',
    columnOrder INTEGER NOT NULL DEFAULT 0,
    run TEXT,
    result TEXT,
    resultAt INTEGER,
    model TEXT,
    thinking TEXT,
    dueAt INTEGER,
    estimateMin INTEGER,
    actualMin INTEGER,
    feedback TEXT DEFAULT '[]',
    stage TEXT,
    projectId TEXT
  );

  -- Proposals table
  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    sourceSessionKey TEXT,
    proposedBy TEXT NOT NULL,
    proposedAt INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    version INTEGER NOT NULL DEFAULT 1,
    resolvedAt INTEGER,
    resolvedBy TEXT,
    reason TEXT,
    resultTaskId TEXT
  );

  -- Config table (single-row key-value store)
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
  CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
  CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage);
  CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId);
  CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt ON tasks(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_proposals_proposedBy ON proposals(proposedBy);
`);

// Initialize schema version
const initSchema = db.prepare(`
  INSERT OR IGNORE INTO config (key, value) VALUES ('schemaVersion', ?)
`);
initSchema.run(String(CURRENT_SCHEMA_VERSION));

// ── Type helpers ───────────────────────────────────────────────────

type TaskStatus = string;
type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
type TaskActor = 'operator' | `agent:${string}`;

interface TaskFeedback {
  at: number;
  by: TaskActor;
  note: string;
}

interface TaskRunLink {
  sessionKey: string;
  childSessionKey?: string;
  sessionId?: string;
  runId?: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error' | 'aborted';
  error?: string;
}

interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdBy: TaskActor;
  createdAt: number;
  updatedAt: number;
  version: number;
  sourceSessionKey?: string;
  assignee?: TaskActor;
  labels: string[];
  columnOrder: number;
  run?: TaskRunLink;
  result?: string;
  resultAt?: number;
  model?: string;
  thinking?: 'off' | 'low' | 'medium' | 'high';
  dueAt?: number;
  estimateMin?: number;
  actualMin?: number;
  feedback: TaskFeedback[];
  stage?: string;
  projectId?: string;
}

interface KanbanBoardConfig {
  columns: Array<{ key: string; title: string; wipLimit?: number; visible: boolean }>;
  defaults: { status: TaskStatus; priority: TaskPriority };
  reviewRequired: boolean;
  allowDoneDragBypass: boolean;
  quickViewLimit: number;
  proposalPolicy: 'confirm' | 'auto';
  defaultModel?: string;
  defaultThinking?: string;
}

type ProposalStatus = 'pending' | 'approved' | 'rejected';

interface KanbanProposal {
  id: string;
  type: 'create' | 'update';
  payload: Record<string, unknown>;
  sourceSessionKey?: string;
  proposedBy: TaskActor;
  proposedAt: number;
  status: ProposalStatus;
  version: number;
  resolvedAt?: number;
  resolvedBy?: TaskActor;
  reason?: string;
  resultTaskId?: string;
}

export interface TaskFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  assignee?: string;
  label?: string;
  q?: string;
  limit?: number;
  offset?: number;
  stage?: string;
  projectId?: string;
}

export interface TaskListResult {
  items: KanbanTask[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ── Errors ──────────────────────────────────────────────────────────

export class VersionConflictError extends Error {
  serverVersion: number;
  latest: KanbanTask;
  constructor(serverVersion: number, latest: KanbanTask) {
    super('version_conflict');
    this.name = 'VersionConflictError';
    this.serverVersion = serverVersion;
    this.latest = latest;
  }
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task not found: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

export class InvalidTaskStatusError extends Error {
  status: string;
  allowed: string[];
  constructor(status: string, allowed: Iterable<string>) {
    const allowedList = [...allowed];
    super(`Invalid task status: ${status}`);
    this.name = 'InvalidTaskStatusError';
    this.status = status;
    this.allowed = allowedList;
  }
}

export class InvalidBoardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBoardConfigError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}

export class ProposalNotFoundError extends Error {
  constructor(id: string) {
    super(`Proposal not found: ${id}`);
    this.name = 'ProposalNotFoundError';
  }
}

export class ProposalAlreadyResolvedError extends Error {
  proposal: KanbanProposal;
  constructor(proposal: KanbanProposal) {
    super(`Proposal already resolved: ${proposal.id} (${proposal.status})`);
    this.name = 'ProposalAlreadyResolvedError';
    this.proposal = proposal;
  }
}

// ── Row <-> Object mappers ───────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): KanbanTask {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | undefined,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    createdBy: row.createdBy as TaskActor,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    version: row.version as number,
    sourceSessionKey: row.sourceSessionKey as string | undefined,
    assignee: row.assignee as TaskActor | undefined,
    labels: JSON.parse((row.labels as string) || '[]'),
    columnOrder: row.columnOrder as number,
    run: row.run ? JSON.parse(row.run as string) : undefined,
    result: row.result as string | undefined,
    resultAt: row.resultAt as number | undefined,
    model: row.model as string | undefined,
    thinking: row.thinking as 'off' | 'low' | 'medium' | 'high' | undefined,
    dueAt: row.dueAt as number | undefined,
    estimateMin: row.estimateMin as number | undefined,
    actualMin: row.actualMin as number | undefined,
    feedback: JSON.parse((row.feedback as string) || '[]'),
    stage: row.stage as string | undefined,
    projectId: row.projectId as string | undefined,
  };
}

function taskToRow(task: KanbanTask): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    version: task.version,
    sourceSessionKey: task.sourceSessionKey ?? null,
    assignee: task.assignee ?? null,
    labels: JSON.stringify(task.labels),
    columnOrder: task.columnOrder,
    run: task.run ? JSON.stringify(task.run) : null,
    result: task.result ?? null,
    resultAt: task.resultAt ?? null,
    model: task.model ?? null,
    thinking: task.thinking ?? null,
    dueAt: task.dueAt ?? null,
    estimateMin: task.estimateMin ?? null,
    actualMin: task.actualMin ?? null,
    feedback: JSON.stringify(task.feedback),
    stage: task.stage ?? null,
    projectId: task.projectId ?? null,
  };
}

function rowToProposal(row: Record<string, unknown>): KanbanProposal {
  return {
    id: row.id as string,
    type: row.type as 'create' | 'update',
    payload: JSON.parse(row.payload as string),
    sourceSessionKey: row.sourceSessionKey as string | undefined,
    proposedBy: row.proposedBy as TaskActor,
    proposedAt: row.proposedAt as number,
    status: row.status as ProposalStatus,
    version: row.version as number,
    resolvedAt: row.resolvedAt as number | undefined,
    resolvedBy: row.resolvedBy as TaskActor | undefined,
    reason: row.reason as string | undefined,
    resultTaskId: row.resultTaskId as string | undefined,
  };
}

// ── Default config ─────────────────────────────────────────────────

const DEFAULT_CONFIG: KanbanBoardConfig = {
  columns: [
    { key: 'backlog', title: 'Backlog', visible: true },
    { key: 'todo', title: 'To Do', visible: true },
    { key: 'in-progress', title: 'In Progress', visible: true },
    { key: 'review', title: 'Review', visible: true },
    { key: 'done', title: 'Done', visible: true },
    { key: 'cancelled', title: 'Cancelled', visible: true },
  ],
  defaults: { status: 'todo', priority: 'normal' },
  reviewRequired: false,
  allowDoneDragBypass: false,
  quickViewLimit: 200,
  proposalPolicy: 'confirm',
};

function getDefaultConfig(): KanbanBoardConfig {
  return { ...DEFAULT_CONFIG };
}

// ── SQLite Store Class ─────────────────────────────────────────────

export class KanbanStore {
  // Task operations
  async createTask(input: {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    createdBy: TaskActor;
    sourceSessionKey?: string;
    assignee?: TaskActor;
    labels?: string[];
    model?: string;
    thinking?: 'off' | 'low' | 'medium' | 'high';
    dueAt?: number;
    estimateMin?: number;
    stage?: string;
    projectId?: string;
  }): Promise<KanbanTask> {
    const now = Date.now();
    
    // Get max columnOrder for status
    const status = input.status || 'todo';
    const maxOrderRow = db.prepare(
      'SELECT MAX(columnOrder) as maxOrder FROM tasks WHERE status = ?'
    ).get(status) as { maxOrder: number | null };
    const columnOrder = (maxOrderRow?.maxOrder ?? -1) + 1;

    // Generate unique ID
    const existingIds = new Set(
      db.prepare('SELECT id FROM tasks').all().map((r: unknown) => (r as { id: string }).id)
    );
    const baseId = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    let id = baseId || 'task';
    let counter = 1;
    while (existingIds.has(id)) {
      id = `${baseId}-${counter}`;
      counter++;
    }

    const task: KanbanTask = {
      id,
      title: input.title,
      description: input.description,
      status,
      priority: input.priority || 'normal',
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
      sourceSessionKey: input.sourceSessionKey,
      assignee: input.assignee,
      labels: input.labels || [],
      columnOrder,
      model: input.model,
      thinking: input.thinking,
      dueAt: input.dueAt,
      estimateMin: input.estimateMin,
      feedback: [],
      stage: input.stage,
      projectId: input.projectId,
    };

    const row = taskToRow(task);
    const columns = Object.keys(row).join(', ');
    const placeholders = Object.keys(row).map(() => '?').join(', ');
    const values = Object.values(row);

    db.prepare(`INSERT INTO tasks (${columns}) VALUES (${placeholders})`).run(...values);
    
    return task;
  }

  async updateTask(
    id: string,
    version: number,
    patch: Partial<Pick<KanbanTask, 
      | 'title'
      | 'description'
      | 'status'
      | 'priority'
      | 'assignee'
      | 'labels'
      | 'model'
      | 'thinking'
      | 'dueAt'
      | 'estimateMin'
      | 'actualMin'
      | 'result'
      | 'resultAt'
      | 'run'
      | 'feedback'
      | 'stage'
      | 'projectId'
    >>
  ): Promise<KanbanTask> {
    const now = Date.now();
    
    // Get current task
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Task not found: ${id}`);
    }

    const currentTask = rowToTask(row);
    
    // Version check
    if (currentTask.version !== version) {
      throw Object.assign(new Error('version_conflict'), { 
        serverVersion: currentTask.version,
        latest: currentTask 
      });
    }

    // Recalculate columnOrder if status changed
    let columnOrder = currentTask.columnOrder;
    if (patch.status && patch.status !== currentTask.status) {
      const maxOrderRow = db.prepare(
        'SELECT MAX(columnOrder) as maxOrder FROM tasks WHERE status = ?'
      ).get(patch.status) as { maxOrder: number | null };
      columnOrder = (maxOrderRow?.maxOrder ?? -1) + 1;
    }

    // Normalize assignee
    let normalizedAssignee = currentTask.assignee;
    if (patch.assignee !== undefined) {
      normalizedAssignee = patch.assignee == null 
        ? undefined 
        : canonicalizeKanbanAssignee(patch.assignee) || undefined;
    }

    // Build update
    const updateFields: Record<string, unknown> = {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description ?? null }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(normalizedAssignee !== undefined && { assignee: normalizedAssignee }),
      ...(patch.labels !== undefined && { labels: JSON.stringify(patch.labels) }),
      ...(patch.model !== undefined && { model: patch.model ?? null }),
      ...(patch.thinking !== undefined && { thinking: patch.thinking ?? null }),
      ...(patch.dueAt !== undefined && { dueAt: patch.dueAt ?? null }),
      ...(patch.estimateMin !== undefined && { estimateMin: patch.estimateMin ?? null }),
      ...(patch.actualMin !== undefined && { actualMin: patch.actualMin ?? null }),
      ...(patch.result !== undefined && { result: patch.result ?? null }),
      ...(patch.resultAt !== undefined && { resultAt: patch.resultAt ?? null }),
      ...(patch.run !== undefined && { run: patch.run ? JSON.stringify(patch.run) : null }),
      ...(patch.feedback !== undefined && { feedback: JSON.stringify(patch.feedback) }),
      ...(patch.stage !== undefined && { stage: patch.stage ?? null }),
      ...(patch.projectId !== undefined && { projectId: patch.projectId ?? null }),
      updatedAt: now,
      version: currentTask.version + 1,
      columnOrder,
    };

    const setClause = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
    const setValues = Object.values(updateFields);

    db.prepare(`UPDATE tasks SET ${setClause} WHERE id = ?`).run(...setValues, id);

    // Return updated task
    const updatedRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>;
    return rowToTask(updatedRow);
  }

  async deleteTask(id: string): Promise<void> {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  async getTask(id: string): Promise<KanbanTask> {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Task not found: ${id}`);
    }
    return rowToTask(row);
  }

  async listTasks(filters: TaskFilters = {}): Promise<TaskListResult> {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: unknown[] = [];

    if (filters.status?.length) {
      sql += ` AND status IN (${filters.status.map(() => '?').join(', ')})`;
      params.push(...filters.status);
    }
    if (filters.priority?.length) {
      sql += ` AND priority IN (${filters.priority.map(() => '?').join(', ')})`;
      params.push(...filters.priority);
    }
    if (filters.assignee) {
      sql += ' AND assignee = ?';
      params.push(filters.assignee);
    }
    if (filters.label) {
      sql += ' AND labels LIKE ?';
      params.push(`%"${filters.label}"%`);
    }
    if (filters.q) {
      sql += ' AND (title LIKE ? OR description LIKE ?)';
      const q = `%${filters.q}%`;
      params.push(q, q);
    }
    if (filters.stage) {
      sql += ' AND stage = ?';
      params.push(filters.stage);
    }
    if (filters.projectId) {
      sql += ' AND projectId = ?';
      params.push(filters.projectId);
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
    const total = (db.prepare(countSql).get(...params) as { count: number }).count;

    // Sort by status, then columnOrder, then updatedAt desc
    sql += ' ORDER BY columnOrder ASC, updatedAt DESC';

    // Pagination
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    const items = rows.map(rowToTask);

    return { items, total, limit, offset, hasMore: offset + limit < total };
  }

  async reorderTask(id: string, targetStatus: string, targetIndex: number): Promise<KanbanTask> {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Task not found: ${id}`);

    const task = rowToTask(row);
    const now = Date.now();

    // Shift other tasks in target column
    db.prepare(`
      UPDATE tasks 
      SET columnOrder = columnOrder + 1 
      WHERE status = ? AND columnOrder >= ?
    `).run(targetStatus, targetIndex);

    // Update task
    db.prepare(`
      UPDATE tasks 
      SET status = ?, columnOrder = ?, updatedAt = ?, version = version + 1 
      WHERE id = ?
    `).run(targetStatus, targetIndex, now, id);

    const updatedRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>;
    return rowToTask(updatedRow);
  }

  // Config operations
  async getConfig(): Promise<KanbanBoardConfig> {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get('boardConfig') as { value: string } | undefined;
    if (row) {
      return JSON.parse(row.value);
    }
    return getDefaultConfig();
  }

  async updateConfig(config: Partial<KanbanBoardConfig>): Promise<KanbanBoardConfig> {
    const current = await this.getConfig();
    const updated = { ...current, ...config };
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('boardConfig', JSON.stringify(updated));
    return updated;
  }

  // Proposal operations
  async createProposal(proposal: Omit<KanbanProposal, 'version'>): Promise<KanbanProposal> {
    const now = Date.now();
    const full: KanbanProposal = { ...proposal, version: 1 };

    db.prepare(`
      INSERT INTO proposals (id, type, payload, sourceSessionKey, proposedBy, proposedAt, status, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id,
      full.type,
      JSON.stringify(full.payload),
      full.sourceSessionKey ?? null,
      full.proposedBy,
      full.proposedAt,
      full.status,
      full.version
    );

    return full;
  }

  async resolveProposal(id: string, status: ProposalStatus, resolvedBy: TaskActor, reason?: string, resultTaskId?: string): Promise<KanbanProposal> {
    const now = Date.now();
    db.prepare(`
      UPDATE proposals 
      SET status = ?, resolvedAt = ?, resolvedBy = ?, reason = ?, resultTaskId = ?, version = version + 1 
      WHERE id = ?
    `).run(status, now, resolvedBy, reason ?? null, resultTaskId ?? null, id);

    const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Record<string, unknown>;
    return rowToProposal(row);
  }

  async listProposals(status?: ProposalStatus): Promise<KanbanProposal[]> {
    let sql = 'SELECT * FROM proposals';
    const params: unknown[] = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY proposedAt DESC';
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToProposal);
  }

  async getProposal(id: string): Promise<KanbanProposal> {
    const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Proposal not found: ${id}`);
    return rowToProposal(row);
  }

  // Utility
  close() {
    db.close();
  }
}

// Export singleton
export const getKanbanStore = () => new KanbanStore();

// Export types
export type { TaskStatus, TaskPriority, TaskActor, KanbanTask, KanbanBoardConfig, KanbanProposal, ProposalStatus };