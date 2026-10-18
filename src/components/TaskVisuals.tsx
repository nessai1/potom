import { Check, Clock, Flag } from "lucide-react";
import type { Task } from "../types";
import {
  doneCount,
  percent,
  statusNames,
  statusColors,
  isUrgent,
  taskId,
} from "../model/tasks";
import { dayDiff, plural, shortDate } from "../model/dates";
export function Badge({ task }: { task: Task }) {
  return (
    <span className={`badge ${statusColors[task.status]}`}>
      <span className="status-dot" />
      {statusNames[task.status]}
    </span>
  );
}
export function Progress({ task }: { task: Task }) {
  const p = percent(task);
  return (
    <div className="task-progress">
      <div className="progress-title">
        <span>
          {doneCount(task)}/{task.checklist.length}
        </span>
        <span>{p}%</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Прогресс задачи"
        aria-valuenow={p}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`progress-fill ${p === 100 ? "complete" : ""}`}
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  );
}
export function Deadline({ task: t }: { task: Task }) {
  const d = t.due ? dayDiff(t.due) : null;
  return (
    <div
      className={`deadline ${t.status !== "done" && d !== null ? (d < 0 ? "overdue" : d <= 2 ? "near" : "") : ""}`}
    >
      {d !== null && d <= 1 && t.status !== "done" && (
        <Clock className="icon" />
      )}
      {!t.due
        ? "Срока нет"
        : d === 0
          ? "Сегодня"
          : d === 1
            ? "Завтра"
            : shortDate(t.due)}
      <small>
        {!t.due
          ? "дата не назначена"
          : t.status === "done"
            ? "готово ✓"
            : d! < 0
              ? "просрочено"
              : d === 0
                ? "тот самый день"
                : d === 1
                  ? "уже совсем скоро"
                  : `через ${d} ${plural(d!, ["день", "дня", "дней"])}`}
      </small>
    </div>
  );
}
export function TaskRow({
  task: t,
  onOpen,
  onComplete,
}: {
  task: Task;
  onOpen: (id: number) => void;
  onComplete: (id: number) => void;
}) {
  return (
    <article
      className={`task-row ${isUrgent(t) ? "urgent" : ""} ${t.status === "done" ? "completed" : ""}`}
      onClick={() => onOpen(t.id)}
    >
      <div className="task-name">
        <button
          className={`task-complete ${t.status === "done" ? "done" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onComplete(t.id);
          }}
          aria-label={
            t.status === "done" ? "Вернуть задачу в работу" : "Завершить задачу"
          }
        >
          {t.status === "done" && <Check className="icon" />}
        </button>
        <div>
          <button
            className="task-title task-open"
            aria-label={`Открыть задачу ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(t.id);
            }}
          >
            {t.title}
          </button>
          <div className="task-meta">
            <span className="task-id">{taskId(t)}</span>
            <Badge task={t} />
            {t.priority === "high" && (
              <span className="task-priority">
                <Flag className="icon" />
                Важно
              </span>
            )}
          </div>
        </div>
      </div>
      <Progress task={t} />
      <Deadline task={t} />
    </article>
  );
}
export function Garden({
  className = "desktop-garden",
}: {
  className?: string;
}) {
  return (
    <span className={className} aria-hidden="true">
      <img
        className="garden-syngonium"
        src="/assets/plant-syngonium.png"
        alt=""
      />
      <img
        className="garden-epipremnum"
        src="/assets/plant-epipremnum.png"
        alt=""
      />
    </span>
  );
}
export function Cat({
  mood = "smug",
  className = "cat-card-art",
}: {
  mood?: "smug" | "sleep" | "chaos";
  className?: string;
}) {
  const cats = {
    smug: ["cat-british", "Серый британский кот"],
    sleep: ["cat-maine-coon", "Серебристый мейн-кун"],
    chaos: ["cat-angora", "Белая турецкая ангора"],
  };
  return (
    <img
      className={`cat-mascot photo-cat ${className}`}
      src={`/assets/${cats[mood][0]}.png`}
      alt={cats[mood][1]}
      draggable={false}
    />
  );
}
