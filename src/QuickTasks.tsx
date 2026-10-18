import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUpRight,
  CalendarDays,
  GripVertical,
  Sparkles,
  X,
} from "lucide-react";
import { loadData, isDesktop } from "./lib/storage";
import {
  listenQuickTasks,
  openQuickTask,
  quickTasksSnapshot,
  requestQuickTasks,
  resizeQuickTasks,
  type QuickTasksSnapshot,
} from "./lib/quickTasks";
import { plural, shortDate } from "./model/dates";
import "./styles/theme-tokens.css";
import "./styles/quick-tasks.css";

export default function QuickTasks() {
  const [snapshot, setSnapshot] = useState<QuickTasksSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const resizing = useRef(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    let received = false;
    let receivedExpanded = false;
    let stop: (() => void) | undefined;
    setError("");
    void (async () => {
      stop = await listenQuickTasks({
        onState: (next) => {
          if (cancelled) return;
          received = true;
          setSnapshot(next);
          setError("");
        },
        onExpanded: (next) => {
          if (cancelled) return;
          receivedExpanded = true;
          setExpanded(next);
        },
      });
      if (cancelled) {
        stop();
        return;
      }
      if (isDesktop()) {
        const current = await invoke<boolean>("quick_tasks_expanded");
        if (!cancelled && !receivedExpanded) setExpanded(current);
      }
      // Subscribe before reading: a slow SQLite response must not replace a
      // newer in-memory snapshot received from the main window.
      await requestQuickTasks();
      const data = await loadData();
      if (!cancelled && !received && data)
        setSnapshot(quickTasksSnapshot(data));
    })().catch((reason: unknown) => {
      if (!cancelled && !received)
        setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [attempt]);

  useEffect(() => {
    if (!snapshot) return;
    document.documentElement.dataset.theme = snapshot.theme;
    document.documentElement.style.colorScheme = snapshot.theme;
  }, [snapshot?.theme]);

  const changeExpanded = useCallback(async (next: boolean) => {
    if (resizing.current) return;
    resizing.current = true;
    try {
      await resizeQuickTasks(next);
      if (!isDesktop()) setExpanded(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      resizing.current = false;
    }
  }, []);
  useEffect(() => {
    if (document.hasFocus())
      (expanded ? closeButton : expandButton).current?.focus();
  }, [expanded]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        void changeExpanded(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [expanded, changeExpanded]);

  const startDragging = async () => {
    if (!isDesktop()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const chooseTask = async (id: number) => {
    try {
      await openQuickTask(id);
      await changeExpanded(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const tasks = snapshot?.tasks || [];

  return (
    <div className={`quick-tasks-shell ${expanded ? "is-expanded" : ""}`}>
      {expanded ? (
        <section className="quick-panel" aria-label="Сейчас в работе">
          <header className="quick-header">
            <span className="quick-mark" aria-hidden="true">
              ✳
            </span>
            <div>
              <h1>Сейчас в работе</h1>
              <p>
                {tasks.length} {plural(tasks.length)} под рукой
              </p>
            </div>
            <button
              className="quick-drag"
              aria-label="Переместить плавающую кнопку"
              title="Потяни, чтобы переместить"
              onPointerDown={(event) => {
                if (event.button === 0) void startDragging();
              }}
            >
              <GripVertical size={16} />
            </button>
            <button
              ref={closeButton}
              className="quick-close"
              aria-label="Свернуть список задач"
              onClick={() => void changeExpanded(false)}
            >
              <X size={17} />
            </button>
          </header>
          <div className="quick-list">
            {error ? (
              <div className="quick-empty" role="alert">
                <p>Не получилось обновить список.</p>
                <small>{error}</small>
                <button onClick={() => setAttempt((value) => value + 1)}>
                  Повторить
                </button>
              </div>
            ) : !snapshot ? (
              <div className="quick-empty" role="status">
                Загружаем задачи…
              </div>
            ) : tasks.length ? (
              tasks.map((task) => (
                <button
                  className="quick-task"
                  key={task.id}
                  aria-label={task.title}
                  onClick={() => void chooseTask(task.id)}
                >
                  <span className="quick-task-top">
                    <span
                      className="quick-project-dot"
                      style={{ background: task.projectColor }}
                    />
                    <span>{task.projectName}</span>
                    <ArrowUpRight size={14} />
                  </span>
                  <strong>{task.title}</strong>
                  <span className="quick-task-bottom">
                    <span>
                      {task.due ? (
                        <>
                          <CalendarDays size={12} />
                          {shortDate(task.due)}
                        </>
                      ) : (
                        "Без срока"
                      )}
                    </span>
                    <span>{task.progress}%</span>
                  </span>
                  <span className="quick-progress" aria-hidden="true">
                    <span style={{ width: `${task.progress}%` }} />
                  </span>
                </button>
              ))
            ) : (
              <div className="quick-empty">
                <Sparkles size={30} strokeWidth={1.2} />
                <p>В работе пока пусто.</p>
                <small>Можно выдохнуть. Или взять одну задачу.</small>
              </div>
            )}
          </div>
          <footer className="quick-footer">
            <span className="quick-live-dot" />
            Поверх окон. Рядом с делами.
          </footer>
        </section>
      ) : (
        <>
          <button
            ref={expandButton}
            className="quick-orb"
            aria-label="Показать задачи в работе"
            aria-expanded={false}
            title={error ? "Не удалось обновить задачи" : "Задачи в работе"}
            onClick={() => void changeExpanded(true)}
          >
            <span aria-hidden="true">✳</span>
            <b>{error ? "!" : snapshot ? tasks.length : "…"}</b>
          </button>
          <button
            className="quick-drag quick-orb-drag"
            aria-label="Переместить плавающую кнопку"
            title="Потяни, чтобы переместить"
            onPointerDown={(event) => {
              if (event.button === 0) void startDragging();
            }}
          >
            <GripVertical size={14} />
          </button>
        </>
      )}
    </div>
  );
}
