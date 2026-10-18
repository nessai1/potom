import {
  ChevronDown,
  Plus,
  SlidersHorizontal,
  PanelsTopLeft,
  Sparkles,
} from "lucide-react";
import type { AppData, Task } from "../types";
import { useState } from "react";
import { statusColumns, statusNames, isUrgent } from "../model/tasks";
import { dayDiff, todayKey } from "../model/dates";
import { Cat, TaskRow } from "../components/TaskVisuals";
export type ListTab = "all" | "today" | "soon" | "done";
interface Props {
  data: AppData;
  tasks: Task[];
  project: string;
  tab: ListTab;
  onTab: (t: ListTab) => void;
  onNew: (project?: string) => void;
  onOpen: (id: number) => void;
  onComplete: (id: number) => void;
  clean: (s: string) => string;
}
export default function ListView({
  data,
  tasks: all,
  project,
  tab,
  onTab,
  onNew,
  onOpen,
  onComplete,
  clean,
}: Props) {
  const [group, setGroup] = useState("project"),
    [urgent, setUrgent] = useState(false),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const today = todayKey(),
    open = all.filter((t) => t.status !== "done");
  const tasks = all.filter((t) =>
    tab === "done"
      ? t.status === "done"
      : t.status !== "done" &&
        (tab !== "today" || t.due === today) &&
        (tab !== "soon" ||
          (t.due && dayDiff(t.due) >= 0 && dayDiff(t.due) <= 2)) &&
        (!urgent || isUrgent(t)),
  );
  type Group = { key: string; title: string; color: string; tasks: Task[] };
  let groups: Group[] = [];
  if (group === "project")
    groups = data.projects.map((p) => ({
      key: p.id,
      title: p.name,
      color: p.color,
      tasks: tasks.filter((t) => t.project === p.id),
    }));
  else if (group === "status")
    groups = statusColumns.map(([key]) => ({
      key,
      title: statusNames[key],
      color: {
        created: "#b5afa4",
        progress: "#dba4bd",
        deferred: "#d8c375",
        done: "#a5b39c",
      }[key],
      tasks: tasks.filter((t) => t.status === key),
    }));
  else if (group === "due")
    groups = [
      {
        key: "late",
        title: "Срок уже прошёл",
        color: "#d4a2a2",
        fn: (t: Task) => !!t.due && dayDiff(t.due) < 0,
      },
      {
        key: "close",
        title: "На носу",
        color: "#d8c375",
        fn: (t: Task) => !!t.due && dayDiff(t.due) >= 0 && dayDiff(t.due) <= 2,
      },
      {
        key: "later",
        title: "Впереди есть время",
        color: "#a5b39c",
        fn: (t: Task) => !!t.due && dayDiff(t.due) > 2,
      },
      {
        key: "someday",
        title: "Когда-нибудь",
        color: "#bab1c6",
        fn: (t: Task) => !t.due,
      },
    ].map((g) => ({ ...g, tasks: tasks.filter(g.fn) }));
  else groups = [{ key: "all", title: "Все задачи", color: "#dba4bd", tasks }];
  const tabs: [ListTab, string, number][] = [
    ["all", "Все задачи", open.length],
    ["today", "Сегодня", open.filter((t) => t.due === today).length],
    [
      "soon",
      "Скоро",
      open.filter((t) => t.due && dayDiff(t.due) >= 0 && dayDiff(t.due) <= 2)
        .length,
    ],
    ["done", "Готово", all.length - open.length],
  ];
  return (
    <>
      <div className="page-top">
        <div>
          <h1>
            {project
              ? data.projects.find((p) => p.id === project)?.name
              : "Мои задачи"}
          </h1>
          <p>
            Требования меняются.{" "}
            <span className="greeting">Скриншоты остаются.</span>
          </p>
        </div>
        <button className="primary-btn" onClick={() => onNew()}>
          <Plus className="icon" />
          Новая задача
        </button>
      </div>
      <div className="summary">
        <div className="summary-item">
          <b>{open.length}</b> всего задач
        </div>
        <div className="summary-item">
          <span className="mini-dot" />
          <b>{open.filter((t) => t.status === "progress").length}</b> в работе
        </div>
        <div className="summary-item">
          <span className="mini-dot" />
          <b>{open.filter((t) => isUrgent(t)).length}</b> скоро дедлайн
        </div>
        <div className="summary-item">
          <span className="mini-dot" />
          <b>{all.length - open.length}</b> готово
        </div>
      </div>
      <div className="view-toolbar">
        <div className="tabs">
          {tabs.map(([id, label, count]) => (
            <button
              className={`tab ${tab === id ? "active" : ""}`}
              key={id}
              onClick={() => {
                onTab(id);
                if (id === "done") setUrgent(false);
              }}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-controls">
          <label className="group-select">
            <PanelsTopLeft className="icon" />
            <select
              aria-label="Группировка"
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setCollapsed(new Set());
              }}
            >
              <option value="project">По проектам</option>
              <option value="status">По статусу</option>
              <option value="due">По сроку</option>
              <option value="none">Без групп</option>
            </select>
          </label>
          <button
            className={`icon-btn filter-button ${urgent ? "active" : ""}`}
            onClick={() => setUrgent(!urgent)}
            aria-label="Фильтр близких сроков"
            aria-pressed={urgent}
          >
            <SlidersHorizontal className="icon" />
          </button>
        </div>
      </div>
      <div className="list-col-head">
        <span>НАЗВАНИЕ ЗАДАЧИ</span>
        <span>ПРОГРЕСС</span>
        <span>КРАЙНИЙ СРОК</span>
      </div>
      {groups
        .filter((g) => g.tasks.length)
        .map((g) => (
          <section className="task-group" key={g.key}>
            <div
              className={`group-header ${collapsed.has(g.key) ? "collapsed" : ""}`}
            >
              <button
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.key)) next.delete(g.key);
                    else next.add(g.key);
                    return next;
                  })
                }
                aria-expanded={!collapsed.has(g.key)}
              >
                <ChevronDown className="icon" />
                <span className="project-dot" style={{ background: g.color }} />
                {g.title}
                <small>{g.tasks.length}</small>
              </button>
              <button
                className="icon-btn"
                onClick={() => onNew(group === "project" ? g.key : undefined)}
                aria-label={`Добавить задачу в ${g.title}`}
              >
                <Plus className="icon" />
              </button>
            </div>
            {!collapsed.has(g.key) && (
              <>
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onOpen={onOpen}
                    onComplete={onComplete}
                  />
                ))}
                <button
                  className="task-add"
                  onClick={() => onNew(group === "project" ? g.key : undefined)}
                >
                  <Plus className="icon" />
                  Добавить задачу
                </button>
              </>
            )}
          </section>
        ))}
      {!tasks.length && (
        <div className="empty">
          <span className="empty-icon">
            <Cat mood="sleep" className="empty-cat" />
          </span>
          {clean(
            tab === "done"
              ? "Пока ничего не закрыто. Бизнес зато уже открыл рот."
              : tab === "today"
                ? "Сегодня ничего не горит. Не обновляй почту."
                : "Пусто. Либо всё сделала, либо забыла записать.",
          )}
          <p>
            <button className="secondary-btn" onClick={() => onNew()}>
              Добавить задачу
            </button>
          </p>
        </div>
      )}
      <div className="list-footnote">
        <Sparkles className="icon" />
        «Просто добавьте поле» — и другие начала катастрофы.
      </div>
    </>
  );
}
