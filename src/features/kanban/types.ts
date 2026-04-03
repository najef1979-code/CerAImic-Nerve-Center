// Kanban type contracts — Frozen v1
// Change policy: coordinator approval + issue-file sync required.

/** Built-in status keys shipped with the default board config. */
export const BUILT_IN_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done', 'cancelled'] as const;

/** Idea funnel stages — stored on KanbanTask.stage */
export const IDEA_STAGES = ['raw', 'proposal', 'investigating', 'accepted', 'deferred', 'not_accepted'] as const;
export type IdeaStage = typeof IDEA_STAGES[number];

export const IDEA_STAGE_LABELS: Record<string, string> = {
  raw: 'Raw',
  proposal: 'Proposal',
  investigating: 'Investigating',
  accepted: 'Accepted',
  deferred: 'Deferred',
  not_accepted: 'Not Accepted',
};

export const IDEA_STAGE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  raw:          { bg: 'bg-gray-500/20',  text: 'text-gray-400',  label: 'Raw' },
  proposal:     { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Proposal' },
  investigating:{ bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Investigating' },
  accepted:     { bg: 'bg-green-500/20',  text: 'text-green-400',  label: 'Accepted' },
  deferred:     { bg: 'bg-blue-500/20',   text: 'text-blue-400',   label: 'Deferred' },
  not_accepted: { bg: 'bg-red-500/20',    text: 'text-red-400',    label: 'Not Accepted' },
};
export type BuiltInStatus = typeof BUILT_IN_STATUSES[number];

/**
 * TaskStatus is a plain string so custom column keys are supported.
 * The board config (from /api/kanban/config) is the canonical source of truth
 * for which statuses are valid and how columns are ordered.
 */
export type TaskStatus = string;
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Default column display order used as a fallback before the board config loads.
 * Consumers should prefer `config.columns` from useKanban() over this constant.
 */
export const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];

/** Human-readable labels for built-in columns. Custom columns use their `title` from config. */
export const COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};
export type TaskActor = 'operator' | `agent:${string}`;

export interface TaskFeedback {
  at: number;
  by: TaskActor;
  note: string;
}

export interface TaskRunLink {
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error' | 'aborted';
  error?: string;
}

export interface KanbanTask {
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
  /** Idea funnel stage (raw, proposal, investigating, accepted, deferred, not_accepted) */
  stage?: string;
  /** Project this task belongs to — groups tasks under a project */
  projectId?: string;
}
