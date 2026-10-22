import { Archive, ArrowUpRight, RotateCcw } from "lucide-react";
import type { Project, Task } from "../types";
import { longDate, plural } from "../model/dates";
import { compareCompletedTasks, taskId } from "../model/tasks";
import "../styles/archive.css";

interface Props {
  tasks: Task[];
  projects: Project[];
  filtered: boolean;
  onOpen: (id: number) => void;
  onRestore: (id: number) => void;
}

export default function ArchiveView({
  tasks,
  projects,
  filtered,
  onOpen,
  onRestore,
}: Props) {
  const sorted = [...tasks].sort(compareCompletedTasks);
  return (
    <section className="archive-view" aria-label="Архив задач">
      <div className="page-top">
        <div>
          <h1>Архив</h1>
          <p>Сделано. Можно выдохнуть.</p>
        </div>
        <span className="archive-count">
          <Archive size={18} />
          {tasks.length} {plural(tasks.length)}
        </span>
      </div>
      <p className="archive-policy">
        В выполненных остаются 10 последних задач. Более старые попадают сюда
        вместе с комментариями и файлами.
      </p>
      {sorted.length ? (
        <ul className="archive-list" aria-label="Архивные задачи">
          {sorted.map((task) => {
            const project = projects.find((p) => p.id === task.project);
            return (
              <li key={task.id} className="archive-task" data-task-id={task.id}>
                <button
                  className="archive-task-open"
                  aria-label={`Открыть ${task.title}`}
                  onClick={() => onOpen(task.id)}
                >
                  <span className="archive-task-copy">
                    <small>{taskId(task)}</small>
                    <strong>{task.title}</strong>
                    <span className="archive-task-meta">
                      <span
                        className="project-dot"
                        style={{ background: project?.color }}
                      />
                      {project?.name || "Без проекта"}
                      {task.completedAt && (
                        <span>Выполнено {longDate(task.completedAt)}</span>
                      )}
                    </span>
                  </span>
                  <ArrowUpRight size={18} aria-hidden="true" />
                </button>
                <button
                  className="archive-restore"
                  onClick={() => onRestore(task.id)}
                  aria-label={`Вернуть в работу: ${task.title}`}
                >
                  <RotateCcw size={15} />
                  <span>Вернуть в работу</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="archive-empty" role="status">
          <Archive size={40} strokeWidth={1.3} />
          <h2>{filtered ? "Ничего не найдено" : "Архив пока пуст"}</h2>
          <p>
            {filtered
              ? "Попробуй другой запрос или убери фильтр проекта."
              : "Когда выполненных задач станет больше десяти, старые появятся здесь."}
          </p>
        </div>
      )}
    </section>
  );
}
