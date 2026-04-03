import { memo, useMemo } from 'react';
import type { KanbanTask, TaskStatus } from './types';
import { KanbanCard } from './KanbanCard';
import { TASK_STATUS_TONE } from './tone';

interface ProjectsViewProps {
  tasks: KanbanTask[];
  onCardClick: (task: KanbanTask) => void;
}

const STATUS_ORDER: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done', 'cancelled'];

export const ProjectsView = memo(function ProjectsView({ tasks, onCardClick }: ProjectsViewProps) {
  // Group tasks by projectId
  const { projectGroups, unassigned } = useMemo(() => {
    const groups: Record<string, KanbanTask[]> = {};
    const unassignedTasks: KanbanTask[] = [];

    for (const task of tasks) {
      const pid = task.projectId?.trim();
      if (!pid) {
        unassignedTasks.push(task);
      } else {
        if (!groups[pid]) groups[pid] = [];
        groups[pid].push(task);
      }
    }

    // Sort tasks within each group by status order
    const sortedGroups: Record<string, KanbanTask[]> = {};
    for (const [pid, pts] of Object.entries(groups)) {
      sortedGroups[pid] = [...pts].sort(
        (a, b) => STATUS_ORDER.indexOf(a.status as TaskStatus) - STATUS_ORDER.indexOf(b.status as TaskStatus)
      );
    }

    return { projectGroups: sortedGroups, unassigned: unassignedTasks };
  }, [tasks]);

  // Sort project IDs — alphabetically, unassigned last
  const sortedProjectIds = useMemo(() => {
    return Object.keys(projectGroups).sort();
  }, [projectGroups]);

  const totalProjects = sortedProjectIds.length;
  const totalUnassigned = unassigned.length;

  if (totalProjects === 0 && totalUnassigned === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">No tasks yet.</p>
          <p className="text-xs mt-1">Create a task with a project ID to see it here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
      {/* Project groups */}
      {sortedProjectIds.map(projectId => {
        const projectTasks = projectGroups[projectId];
        const tasksByStatus = groupByStatus(projectTasks);

        return (
          <div key={projectId} className="space-y-3">
            {/* Project header */}
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-foreground truncate">{projectId}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                {projectTasks.length} task{projectTasks.length !== 1 ? 's' : ''}
              </span>
              {/* Status dots */}
              <div className="flex items-center gap-1.5 ml-auto">
                {STATUS_ORDER.map(status => {
                  const count = tasksByStatus[status]?.length ?? 0;
                  if (count === 0) return null;
                  const tone = TASK_STATUS_TONE[status];
                  return (
                    <span
                      key={status}
                      title={`${status}: ${count}`}
                      className={`inline-flex items-center justify-center rounded-full w-5 h-5 text-[0.6rem] font-bold ${tone.badgeClass}`}
                    >
                      {count}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Task cards by status */}
            <div className="space-y-4">
              {STATUS_ORDER.map(status => {
                const statusTasks = tasksByStatus[status];
                if (!statusTasks || statusTasks.length === 0) return null;
                return (
                  <div key={status} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={status} />
                      <div className="flex-1 border-t border-border/30" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {statusTasks.map(task => (
                        <KanbanCard
                          key={task.id}
                          task={task}
                          onClick={() => onCardClick(task)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Unassigned tasks */}
      {totalUnassigned > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Unassigned</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalUnassigned} task{totalUnassigned !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="space-y-4">
            {STATUS_ORDER.map(status => {
              const statusTasks = groupByStatus(unassigned)[status];
              if (!statusTasks || statusTasks.length === 0) return null;
              return (
                <div key={status} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status} />
                    <div className="flex-1 border-t border-border/30" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {statusTasks.map(task => (
                      <KanbanCard
                        key={task.id}
                        task={task}
                        onClick={() => onCardClick(task)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

function StatusBadge({ status }: { status: TaskStatus }) {
  const tone = TASK_STATUS_TONE[status];
  const labels: Record<TaskStatus, string> = {
    backlog: 'Backlog',
    todo: 'To Do',
    'in-progress': 'In Progress',
    review: 'Review',
    done: 'Done',
    cancelled: 'Cancelled',
  };
  return (
    <span className={`text-[0.667rem] font-semibold px-1.5 py-0.5 rounded ${tone.badgeClass}`}>
      {labels[status] ?? status}
    </span>
  );
}

function groupByStatus(tasks: KanbanTask[]): Record<string, KanbanTask[]> {
  const result: Record<string, KanbanTask[]> = {};
  for (const task of tasks) {
    if (!result[task.status]) result[task.status] = [];
    result[task.status].push(task);
  }
  return result;
}
