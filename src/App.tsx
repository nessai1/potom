import "./styles/prototype.css";
import "./styles/task-modal.css";
import "./styles/theme.css";
import "./styles/calendar.css";
import "./styles/editor.css";
import "./styles/app.css";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  HelpCircle,
  KanbanSquare,
  ListChecks,
  LoaderCircle,
  Moon,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  Trophy,
  Upload,
  AlertCircle,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type {
  AppData,
  Project,
  SaveState,
  Status,
  Task,
  UpdateTask,
} from "./types";
import {
  loadData,
  saveData,
  resetData,
  exportBackup,
  importBackup,
  getStorageInfo,
  isDesktop,
  flushBrowserData,
  parseArchive,
} from "./lib/storage";
import { MAX_WORKSPACE_BYTES, readAttachmentFiles } from "./lib/attachments";
import { catRemarks } from "./model/cat-remarks";
import { createInitialData } from "./model/initial-data";
import {
  listenQuickTasks,
  publishQuickTasks,
  quickTasksSnapshot,
} from "./lib/quickTasks";
import { cleanInterfaceCopy } from "./model/copy";
import {
  achievements,
  evaluateAchievements,
  filterTasks,
  percent,
  recordEvent,
  updateTask as reduceTask,
} from "./model/tasks";
import { todayKey, plural } from "./model/dates";
import { Cat, Garden } from "./components/TaskVisuals";
import TaskDetail from "./components/TaskDetail";
import Dialog from "./components/Dialog";
import ListView, { type ListTab } from "./views/ListView";
import BoardView from "./views/BoardView";
import CalendarView from "./views/CalendarView";
import AchievementsView from "./views/AchievementsView";

type View = "list" | "board" | "calendar" | "achievements";
type Modal =
  | { kind: "new"; project?: string; status?: Status; due?: string }
  | { kind: "project"; project?: Project }
  | { kind: "deleteTask"; id: number }
  | { kind: "deleteProject"; project: Project }
  | { kind: "settings" }
  | { kind: "help" }
  | { kind: "profile" }
  | { kind: "import" }
  | { kind: "reset" }
  | null;
const viewNames: Record<View, string> = {
  list: "Мои задачи",
  board: "Канбан",
  calendar: "Календарь",
  achievements: "Достижения",
};
const saveLabels: Record<SaveState, string> = {
  loading: "Загружаем данные…",
  saving: "Сохраняем изменения…",
  saved: "Все изменения сохранены",
  error: "Не удалось сохранить",
};
const flushEditors = () =>
  document.dispatchEvent(new Event("potom:flush-editors"));
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default function App() {
  const [data, setData] = useState<AppData | null>(null),
    dataRef = useRef<AppData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading"),
    [loadError, setLoadError] = useState(""),
    [saveError, setSaveError] = useState(""),
    [operationError, setOperationError] = useState("");
  const [view, setView] = useState<View>("list"),
    [tab, setTab] = useState<ListTab>("all"),
    [search, setSearch] = useState(""),
    [projectFilter, setProjectFilter] = useState(""),
    [selectedId, setSelectedId] = useState<number | null>(null),
    [modal, setModal] = useState<Modal>(null),
    [activeOpen, setActiveOpen] = useState(false),
    [catIndex, setCatIndex] = useState(0),
    [toast, setToast] = useState(""),
    [storageInfo, setStorageInfo] = useState<{
      path: string;
      backupDirectory: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const initializing = useRef(false);
  const workspaceGeneration = useRef(0);
  const pendingAttachments = useRef(new Set<Promise<void>>());
  const pendingQuickTask = useRef<number | null>(null);
  const publishedQuickState = useRef("");
  const [, setCurrentDay] = useState(todayKey);
  const version = useRef(0),
    savedVersion = useRef(0),
    writeQueue = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    searchRef = useRef<HTMLInputElement>(null),
    activeRef = useRef<HTMLDivElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true);
  const inform = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3600);
  }, []);
  const persist = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (writeQueue.current) {
      await writeQueue.current.catch(() => {});
    }
    if (!dataRef.current || savedVersion.current >= version.current) return;
    const run = async () => {
      setSaveState("saving");
      try {
        while (dataRef.current && savedVersion.current < version.current) {
          const targetVersion = version.current;
          const snapshot = structuredClone(dataRef.current);
          await saveData(snapshot);
          savedVersion.current = targetVersion;
        }
        if (mounted.current) {
          setSaveState("saved");
          setSaveError("");
        }
      } catch (error) {
        if (mounted.current) {
          setSaveState("error");
          setSaveError(errorText(error));
        }
        throw error;
      }
    };
    const pending = run();
    writeQueue.current = pending;
    try {
      await pending;
    } finally {
      if (writeQueue.current === pending) writeQueue.current = null;
    }
  }, []);
  const mutate = useCallback(
    (recipe: (current: AppData) => AppData) => {
      if (!dataRef.current) return;
      const before = dataRef.current;
      const after = evaluateAchievements(recipe(before));
      if (before === after) return;
      dataRef.current = after;
      version.current++;
      setData(after);
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist().catch(() => {}), 350);
      const newly = after.unlocked.filter(
        (id) => !before.unlocked.includes(id),
      );
      if (newly.length) {
        const a = achievements.find((a) => a.id === newly[0]);
        if (a)
          inform(
            `✦ Новая ачивка: ${after.settings.cleanLanguage ? a.cleanTitle : a.title}`,
          );
      }
    },
    [inform, persist],
  );
  const updateTask: UpdateTask = useCallback(
    (id, update) => mutate((current) => reduceTask(current, id, update)),
    [mutate],
  );
  const readAndAddAttachments = useCallback(
    async (id: number, files: File[]) => {
      if (!files.length) return;
      const generation = workspaceGeneration.current;
      const before = dataRef.current;
      if (!before?.tasks.some((task) => task.id === id))
        throw new Error("Задача уже удалена.");
      const encodedBytes = files.reduce(
        (sum, file) => sum + Math.ceil(file.size / 3) * 4,
        0,
      );
      if (
        new TextEncoder().encode(JSON.stringify(before)).byteLength +
          encodedBytes >
        MAX_WORKSPACE_BYTES
      )
        throw new Error(
          "Недостаточно места: размер пространства с вложениями не должен превышать 50 МБ.",
        );
      const attachments = await readAttachmentFiles(files);
      flushEditors();
      const current = dataRef.current;
      if (
        generation !== workspaceGeneration.current ||
        !current?.tasks.some((task) => task.id === id)
      )
        throw new Error(
          "Пространство изменилось. Откройте задачу и прикрепите файлы заново.",
        );
      const candidate = {
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === id
            ? {
                ...task,
                attachments: [...(task.attachments ?? []), ...attachments],
              }
            : task,
        ),
      };
      // Validate the complete workspace before committing any part of a batch.
      parseArchive(JSON.stringify(candidate));
      mutate(() => candidate);
    },
    [mutate],
  );
  const addAttachments = useCallback(
    (id: number, files: File[]) => {
      const pending = readAndAddAttachments(id, files);
      pendingAttachments.current.add(pending);
      const finish = () => {
        pendingAttachments.current.delete(pending);
      };
      void pending.then(finish, (error: unknown) => {
        finish();
        inform(`Файлы не прикреплены: ${errorText(error)}`);
      });
      return pending;
    },
    [readAndAddAttachments, inform],
  );
  const event = useCallback(
    (name: string) => mutate((current) => recordEvent(current, name)),
    [mutate],
  );
  const flush = useCallback(async () => {
    flushEditors();
    while (pendingAttachments.current.size)
      await Promise.all([...pendingAttachments.current]);
    await persist();
  }, [persist]);
  const init = useCallback(async () => {
    if (initializing.current) return;
    initializing.current = true;
    setLoadError("");
    setSaveState("loading");
    try {
      const loaded = await loadData();
      const next = evaluateAchievements(loaded ?? createInitialData());
      const changed =
        !loaded ||
        JSON.stringify(next.unlocked) !== JSON.stringify(loaded.unlocked);
      workspaceGeneration.current++;
      dataRef.current = next;
      version.current = 1;
      savedVersion.current = changed ? 0 : 1;
      setData(next);
      setSaveState("saved");
      if (changed) await persist();
      getStorageInfo()
        .then(setStorageInfo)
        .catch(() => {});
    } catch (error) {
      setLoadError(errorText(error));
      setSaveState("error");
    } finally {
      initializing.current = false;
    }
  }, [persist]);
  useEffect(() => {
    const tick = setInterval(() => setCurrentDay(todayKey()), 30_000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    mounted.current = true;
    void init();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [init]);
  useEffect(() => {
    if (!data) return;
    document.documentElement.dataset.theme = data.settings.theme;
    document.documentElement.dataset.cleanLanguage = String(
      data.settings.cleanLanguage,
    );
    document.documentElement.style.colorScheme = data.settings.theme;
  }, [data?.settings.theme, data?.settings.cleanLanguage]);
  useEffect(() => {
    let cancelled = false;
    let closing = false;
    const stops: Array<() => void> = [];
    const register = (stop: () => void) => {
      if (cancelled) stop();
      else stops.push(stop);
    };
    if (isDesktop()) {
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          const requestClose = async (quit: boolean) => {
            if (closing) return;
            closing = true;
            try {
              await flush();
              if (quit) await invoke<void>("finish_quit");
              else await win.destroy();
            } catch (error) {
              closing = false;
              setModal({ kind: "settings" });
              setOperationError(errorText(error));
              inform("Окно осталось открытым: сначала сохраните изменения.");
            }
          };
          register(
            await win.onCloseRequested((event) => {
              event.preventDefault();
              void requestClose(false);
            }),
          );
          register(
            await listen("potom:request-quit", () => void requestClose(true)),
          );
        })
        .catch((error) =>
          setOperationError(
            `Не удалось подключить сохранение при закрытии: ${errorText(error)}`,
          ),
        );
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      flushEditors();
      if (pendingAttachments.current.size) {
        event.preventDefault();
        event.returnValue = "";
        return;
      }
      if (
        !isDesktop() &&
        dataRef.current &&
        version.current > savedVersion.current
      ) {
        try {
          flushBrowserData(dataRef.current);
          savedVersion.current = version.current;
        } catch {
          event.preventDefault();
          event.returnValue = "";
        }
      } else if (isDesktop() && version.current > savedVersion.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [flush, inform]);
  const closeTask = useCallback(() => {
    flushEditors();
    setSelectedId(null);
    void persist().catch(() => {});
  }, [persist]);
  const openTask = useCallback((id: number) => {
    flushEditors();
    setActiveOpen(false);
    setSelectedId(id);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    void listenQuickTasks({
      onRequest: () => {
        if (dataRef.current)
          void publishQuickTasks(quickTasksSnapshot(dataRef.current)).catch(
            () => {},
          );
      },
      onOpen: (id) => {
        if (!dataRef.current) {
          pendingQuickTask.current = id;
          return;
        }
        if (dataRef.current.tasks.some((task) => task.id === id)) {
          setModal(null);
          openTask(id);
        }
      },
    })
      .then((dispose) => {
        if (cancelled) dispose();
        else stop = dispose;
      })
      .catch((error) =>
        setOperationError(
          `Не удалось подключить плавающую кнопку: ${errorText(error)}`,
        ),
      );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [openTask]);
  useEffect(() => {
    if (!data) return;
    const snapshot = quickTasksSnapshot(data);
    const serialized = JSON.stringify(snapshot);
    if (serialized !== publishedQuickState.current) {
      publishedQuickState.current = serialized;
      void publishQuickTasks(snapshot).catch(() => {});
    }
    const pending = pendingQuickTask.current;
    if (pending !== null) {
      pendingQuickTask.current = null;
      if (data.tasks.some((task) => task.id === pending)) openTask(pending);
    }
  }, [data, openTask]);
  const newTask = useCallback(
    (project?: string, status?: Status, due?: string) => {
      flushEditors();
      setOperationError("");
      setModal({ kind: "new", project, status, due });
    },
    [],
  );
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      const input = el.matches("input,textarea,select") || el.isContentEditable;
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        !input &&
        !modal &&
        selectedId === null
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "," &&
        !modal &&
        selectedId === null
      ) {
        e.preventDefault();
        setModal({ kind: "settings" });
      } else if (
        e.key.toLowerCase() === "n" &&
        !input &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !modal &&
        selectedId === null
      ) {
        e.preventDefault();
        newTask();
      } else if (e.key === "Escape" && !modal && selectedId === null)
        setActiveOpen(false);
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [modal, selectedId, newTask]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (activeRef.current && !activeRef.current.contains(e.target as Node))
        setActiveOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const clean = useCallback(
    (text: string) =>
      data?.settings.cleanLanguage ? cleanInterfaceCopy(text) : text,
    [data?.settings.cleanLanguage],
  );
  const toggleTheme = () => {
    flushEditors();
    mutate((current) => {
      const next = {
        ...current,
        settings: {
          ...current.settings,
          theme:
            current.settings.theme === "dark"
              ? ("light" as const)
              : ("dark" as const),
        },
      };
      return next.settings.theme === "dark"
        ? recordEvent(next, "nightTheme")
        : next;
    });
  };
  const toggleLanguage = () => {
    flushEditors();
    mutate((current) => ({
      ...current,
      settings: {
        ...current.settings,
        cleanLanguage: !current.settings.cleanLanguage,
      },
    }));
  };
  const duplicate = (id: number) => {
    flushEditors();
    const task = dataRef.current?.tasks.find((t) => t.id === id);
    if (!task) return;
    const copy = {
      ...structuredClone(task),
      id: Math.max(0, ...dataRef.current!.tasks.map((t) => t.id)) + 1,
      title: `${task.title} — копия`,
      status: "created" as const,
      created: todayKey(),
    };
    delete copy.completedAt;
    const current = dataRef.current!;
    const candidate = evaluateAchievements({
      ...current,
      tasks: [...current.tasks, copy],
    });
    if (
      new TextEncoder().encode(JSON.stringify(candidate)).byteLength >
      MAX_WORKSPACE_BYTES
    ) {
      inform(
        "Не удалось создать копию: пространство с вложениями превысит 50 МБ.",
      );
      return;
    }
    mutate(() => candidate);
    setSelectedId(copy.id);
    inform("Копия задачи создана");
  };
  const confirmDelete = (id: number) => {
    flushEditors();
    setModal({ kind: "deleteTask", id });
  };
  const doImport = async () => {
    setBusy(true);
    setOperationError("");
    try {
      if (dataRef.current) await flush();
      const imported = await importBackup();
      if (imported) {
        const next = evaluateAchievements(imported);
        workspaceGeneration.current++;
        dataRef.current = next;
        version.current++;
        savedVersion.current =
          JSON.stringify(next.unlocked) === JSON.stringify(imported.unlocked)
            ? version.current
            : version.current - 1;
        setData(next);
        setLoadError("");
        setSaveError("");
        setSaveState("saved");
        if (savedVersion.current < version.current) await persist();
        setSelectedId(null);
        setModal(null);
        setProjectFilter("");
        setSearch("");
        inform("Резервная копия восстановлена");
      }
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const doExport = async () => {
    setBusy(true);
    setOperationError("");
    try {
      await flush();
      const path = await exportBackup();
      if (path) inform("Резервная копия сохранена");
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const doReset = async () => {
    if (busy) return;
    setBusy(true);
    setOperationError("");
    try {
      if (dataRef.current) await flush();
      const next = await resetData();
      workspaceGeneration.current++;
      dataRef.current = next;
      version.current++;
      savedVersion.current = version.current;
      setData(next);
      setLoadError("");
      setSaveError("");
      setSaveState("saved");
      setSelectedId(null);
      setModal(null);
      setView("list");
      setTab("all");
      setProjectFilter("");
      setSearch("");
      setActiveOpen(false);
      getStorageInfo()
        .then(setStorageInfo)
        .catch(() => {});
      inform("Чистый лист. Все достижения снова закрыты.");
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const closeModal = () => {
    setModal(null);
    setOperationError("");
  };
  const resetDialog = modal?.kind === "reset" && (
    <ResetData
      busy={busy}
      error={operationError}
      onClose={() => {
        if (!busy) closeModal();
      }}
      onReset={() => void doReset()}
    />
  );
  const navigate = (next: View) => {
    flushEditors();
    setSelectedId(null);
    setView(next);
    setProjectFilter("");
    setActiveOpen(false);
  };
  if (!data) {
    return (
      <div className="startup-screen">
        <span className="brand">
          <span className="brand-mark">✳</span>потом
          <span className="brand-period">.</span>
        </span>
        {loadError ? (
          <section className="load-error" role="alert">
            <AlertCircle size={32} />
            <h1>Не удалось открыть данные</h1>
            <p>{loadError}</p>
            <p>
              Существующее хранилище сохранено. Можно повторить загрузку или
              восстановить резервную копию.
            </p>
            <div className="startup-actions">
              <button className="primary-btn" onClick={() => void init()}>
                Повторить загрузку
              </button>
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => void doImport()}
              >
                <Upload className="icon" />
                Импорт резервной копии
              </button>
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => {
                  setOperationError("");
                  setModal({ kind: "reset" });
                }}
              >
                Сбросить данные
              </button>
            </div>
            {operationError && <p role="alert">{operationError}</p>}
          </section>
        ) : (
          <p className="loading-copy">
            <LoaderCircle className="spin" size={18} />
            Открываем личное пространство…
          </p>
        )}
        {resetDialog}
      </div>
    );
  }
  const visibleProjects = data.projects.map((p) => ({
    ...p,
    name: clean(p.name),
  }));
  const visibleData = { ...data, projects: visibleProjects };
  const tasks = filterTasks(data, search, projectFilter).map((t) => ({
      ...t,
      title: clean(t.title),
    })),
    active = data.tasks.filter((t) => t.status === "progress"),
    selected = data.tasks.find((t) => t.id === selectedId),
    currentProject = visibleProjects.find((p) => p.id === projectFilter);
  return (
    <>
      <div className={`app-shell ${isDesktop() ? "native-shell" : ""}`}>
        <div className="titlebar">
          <span>
            потом. <span className="titlebar-separator">/</span> Личное
            пространство
          </span>
          <span className="local-label">Лапки есть. ТЗ нет.</span>
        </div>
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("board");
              setSearch("");
              setTab("all");
            }}
            aria-label="потом. Главная"
          >
            <span className="brand-mark">✳</span>потом
            <span className="brand-period">.</span>
          </a>
          <button
            className="workspace"
            onClick={() => setModal({ kind: "profile" })}
          >
            <span className="workspace-avatar">Я</span>
            <span>
              Моё пространство<small>Личное</small>
            </span>
            <ChevronDown className="icon" />
          </button>
          <div className="nav-label">ПРОСТРАНСТВО</div>
          <nav aria-label="Основная навигация">
            {(
              [
                ["list", ListChecks],
                ["board", KanbanSquare],
                ["calendar", CalendarDays],
                ["achievements", Trophy],
              ] as const
            ).map(([key, Icon]) => (
              <button
                key={key}
                className={`nav-item ${view === key ? "active" : ""}`}
                onClick={() => navigate(key)}
                aria-label={viewNames[key]}
                aria-current={view === key ? "page" : undefined}
              >
                <Icon className="icon" />
                <span>{viewNames[key]}</span>
                {key === "list" && (
                  <b>{data.tasks.filter((t) => t.status !== "done").length}</b>
                )}
                {key === "achievements" && (
                  <span className="nav-achievement">
                    {data.unlocked.length}/{achievements.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="nav-label project-heading">
            МОИ ПРОЕКТЫ
            <button
              className="icon-btn"
              onClick={() => setModal({ kind: "project" })}
              aria-label="Добавить проект"
            >
              <Plus className="icon" />
            </button>
          </div>
          <div id="projects">
            {data.projects.map((p) => (
              <div className="project-wrap" key={p.id}>
                <button
                  className={`project-item ${projectFilter === p.id ? "chosen" : ""}`}
                  onClick={() => {
                    setProjectFilter(projectFilter === p.id ? "" : p.id);
                    if (view === "achievements") setView("list");
                  }}
                >
                  <span
                    className="project-dot"
                    style={{ background: p.color }}
                  />
                  <span>{clean(p.name)}</span>
                  <small>
                    {
                      data.tasks.filter(
                        (t) => t.project === p.id && t.status !== "done",
                      ).length
                    }
                  </small>
                </button>
                <button
                  className="project-menu icon-btn"
                  aria-label={`Настроить проект ${p.name}`}
                  onClick={() => setModal({ kind: "project", project: p })}
                >
                  <MoreHorizontal className="icon" />
                </button>
              </div>
            ))}
          </div>
          <div className="sidebar-bottom">
            <button
              className="sidebar-cat-card"
              onClick={() => {
                setCatIndex((index) => (index + 1) % catRemarks.length);
                event("catPets");
              }}
              title="Потыкать кота"
            >
              <span id="sidebar-garden">
                <Garden />
              </span>
              <span
                id="sidebar-cat-art"
                key={`${catIndex}-${data.settings.theme}`}
                className="cat-boop"
              >
                <Cat
                  mood={
                    catIndex === 0
                      ? data.settings.theme === "dark"
                        ? "sleep"
                        : "smug"
                      : (["smug", "chaos", "sleep"] as const)[catIndex % 3]
                  }
                />
              </span>
              <span className="cat-bubble">
                {data.settings.cleanLanguage
                  ? catRemarks[catIndex].clean
                  : catRemarks[catIndex].text}
              </span>
              <small>Кот-аналитик · нажми на морду</small>
            </button>
            <button
              className="nav-item"
              onClick={() => setModal({ kind: "settings" })}
            >
              <SettingsIcon className="icon" />
              <span>Настройки</span>
              <kbd>⌘ ,</kbd>
            </button>
            <div className={`sidebar-footer save-${saveState}`} role="status">
              <span className="online-dot" />
              {saveLabels[saveState]}
              <button
                className="icon-btn"
                aria-label="Помощь"
                onClick={() => setModal({ kind: "help" })}
              >
                <HelpCircle className="icon" />
              </button>
            </div>
          </div>
        </aside>
        <div className="app-body">
          <header className="topbar">
            <div className="breadcrumb">
              <span>Личное пространство</span>
              <ChevronRight className="icon" />
              <strong>{currentProject?.name || viewNames[view]}</strong>
            </div>
            <div className="topbar-right">
              <div className="search-wrap">
                <Search className="icon" />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    if (view === "achievements") setView("list");
                  }}
                  placeholder="Найти задачу"
                  aria-label="Найти задачу"
                />
                <kbd>⌘ K</kbd>
              </div>
              <div className="active-wrap" ref={activeRef}>
                <button
                  className="active-pill"
                  onClick={() => {
                    if (isDesktop())
                      void invoke("show_quick_tasks").catch((error) =>
                        setOperationError(
                          `Не удалось открыть задачи в работе: ${errorText(error)}`,
                        ),
                      );
                    else setActiveOpen(!activeOpen);
                  }}
                  aria-expanded={isDesktop() ? undefined : activeOpen}
                  aria-controls={isDesktop() ? undefined : "active-popover"}
                >
                  <span className="pulse-dot" />В работе <b>{active.length}</b>
                </button>
                {activeOpen && (
                  <div id="active-popover" className="popover">
                    <div className="popover-head">
                      Сейчас в работе
                      <small>
                        {active.length} {plural(active.length)}
                      </small>
                    </div>
                    {active.length ? (
                      active.map((t) => (
                        <button
                          className="popover-task"
                          key={t.id}
                          onClick={() => openTask(t.id)}
                        >
                          <span className="pulse-dot" />
                          <span>
                            <b>{clean(t.title)}</b>
                            <small>
                              {clean(
                                data.projects.find((p) => p.id === t.project)
                                  ?.name || "",
                              )}{" "}
                              · {percent(t)}% готово
                            </small>
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="empty">
                        В работе пусто. Не говори об этом менеджеру.
                      </p>
                    )}
                    <div className="popover-footer">
                      Взяла три задачи. Все три взяли тебя.
                    </div>
                  </div>
                )}
              </div>
              <button
                className={`language-toggle ${data.settings.cleanLanguage ? "clean" : ""}`}
                onClick={toggleLanguage}
                aria-label={
                  data.settings.cleanLanguage
                    ? "Включить мат"
                    : "Включить режим без мата"
                }
                aria-pressed={data.settings.cleanLanguage}
              >
                {data.settings.cleanLanguage ? "✧ Без мата" : "✳ Мат: вкл"}
              </button>
              <button
                className="theme-toggle"
                onClick={toggleTheme}
                aria-label={
                  data.settings.theme === "dark"
                    ? "Включить светлую тему"
                    : "Включить тёмную тему"
                }
                title="Сменить тему"
              >
                {data.settings.theme === "dark" ? (
                  <Sun size={18} />
                ) : (
                  <Moon size={18} />
                )}
              </button>
              <button
                className="avatar"
                onClick={() => setModal({ kind: "profile" })}
                title="Ваш профиль"
              >
                Я
              </button>
            </div>
          </header>
          {(saveError || operationError) && (
            <div className="storage-error" role="alert">
              <AlertCircle size={16} />
              <span>
                {saveError
                  ? `Изменения пока не сохранены: ${saveError}`
                  : operationError}
              </span>
              {saveError && (
                <button onClick={() => void flush().catch(() => {})}>
                  Повторить сохранение
                </button>
              )}
            </div>
          )}
          <div className="workspace-body">
            <main className={view === "list" ? "" : "view-wide"}>
              {projectFilter && view !== "list" && (
                <div className="filter-chip">
                  <span
                    className="project-dot"
                    style={{ background: currentProject?.color }}
                  />
                  {currentProject?.name}
                  <button
                    onClick={() => setProjectFilter("")}
                    aria-label="Сбросить фильтр проекта"
                  >
                    ×
                  </button>
                </div>
              )}
              {view === "list" && (
                <ListView
                  data={visibleData}
                  tasks={tasks}
                  project={projectFilter}
                  tab={tab}
                  onTab={setTab}
                  onNew={(p) => newTask(p)}
                  onOpen={openTask}
                  onComplete={(id) =>
                    updateTask(id, (t) => ({
                      ...t,
                      status: t.status === "done" ? "created" : "done",
                    }))
                  }
                  clean={clean}
                />
              )}
              {view === "board" && (
                <BoardView
                  tasks={tasks}
                  projects={visibleProjects}
                  onOpen={openTask}
                  onMove={(id, status) => {
                    const before = dataRef.current?.tasks.find(
                      (t) => t.id === id,
                    );
                    if (before && before.status !== status) {
                      updateTask(id, (t) => ({ ...t, status }));
                      event("boardMove");
                    }
                  }}
                  onNew={(s) => newTask(undefined, s)}
                  onDone={() => {
                    setView("list");
                    setTab("done");
                  }}
                  clean={clean}
                />
              )}
              {view === "calendar" && (
                <CalendarView
                  tasks={tasks}
                  projects={visibleProjects}
                  onOpen={openTask}
                  onNew={(due) => newTask(undefined, "created", due)}
                />
              )}
              {view === "achievements" && (
                <AchievementsView data={data} clean={clean} />
              )}
            </main>
          </div>
        </div>
      </div>
      {selected && (
        <TaskDetail
          key={selected.id}
          task={selected}
          projects={data.projects}
          cleanLanguage={data.settings.cleanLanguage}
          saveState={saveState}
          onUpdate={updateTask}
          onClose={closeTask}
          onDuplicate={duplicate}
          onDelete={confirmDelete}
          onEvent={event}
          onAddAttachments={addAttachments}
        />
      )}
      {modal?.kind === "new" && (
        <NewTaskForm
          projects={data.projects}
          initialProject={
            modal.project || projectFilter || data.projects[0]?.id
          }
          initialStatus={modal.status || "created"}
          initialDue={modal.due || ""}
          onClose={closeModal}
          onCreate={(task, firstProjectName) => {
            const id =
              Math.max(0, ...dataRef.current!.tasks.map((t) => t.id)) + 1;
            const firstProject = firstProjectName
              ? {
                  id: `project-${Date.now()}`,
                  name: firstProjectName,
                  color: "#dba4bd",
                }
              : null;
            const next: Task = {
              ...task,
              project: firstProject?.id ?? task.project,
              id,
              checklist: [],
              notes: [],
              attachments: [],
              created: todayKey(),
            };
            const desiredStatus = next.status;
            mutate((current) => {
              const added = {
                ...current,
                projects: firstProject
                  ? [...current.projects, firstProject]
                  : current.projects,
                tasks: [
                  ...current.tasks,
                  {
                    ...next,
                    status:
                      desiredStatus === "done" || desiredStatus === "deferred"
                        ? ("created" as const)
                        : desiredStatus,
                  },
                ],
              };
              return desiredStatus === "done" || desiredStatus === "deferred"
                ? reduceTask(added, id, (t) => ({
                    ...t,
                    status: desiredStatus,
                  }))
                : added;
            });
            setModal(null);
            setTab("all");
            setSearch("");
            if (projectFilter && projectFilter !== next.project)
              setProjectFilter("");
            if (view === "achievements") setView("list");
            setSelectedId(id);
          }}
        />
      )}
      {modal?.kind === "project" && (
        <ProjectForm
          project={modal.project}
          onClose={closeModal}
          onDelete={(p) => setModal({ kind: "deleteProject", project: p })}
          onSave={(name, color) => {
            const existing = modal.project;
            mutate((current) => ({
              ...current,
              projects: existing
                ? current.projects.map((p) =>
                    p.id === existing.id ? { ...p, name, color } : p,
                  )
                : [
                    ...current.projects,
                    { id: `project-${Date.now()}`, name, color },
                  ],
            }));
            closeModal();
          }}
        />
      )}
      {modal?.kind === "deleteTask" && (
        <Dialog title="Удалить задачу?" onClose={closeModal}>
          <p>
            Задача «{data.tasks.find((t) => t.id === modal.id)?.title}», её
            чеклист, комментарии и вложения будут удалены.
          </p>
          <div className="modal-footer">
            <button className="secondary-btn" onClick={closeModal}>
              Оставить
            </button>
            <button
              className="danger-btn"
              onClick={() => {
                const id = modal.id;
                workspaceGeneration.current++;
                mutate((current) => ({
                  ...current,
                  tasks: current.tasks.filter((t) => t.id !== id),
                }));
                setSelectedId(null);
                closeModal();
                inform("Задача удалена");
              }}
            >
              <Trash2 className="icon" />
              Удалить задачу
            </button>
          </div>
        </Dialog>
      )}
      {modal?.kind === "deleteProject" && (
        <DeleteProject
          project={modal.project}
          projects={data.projects}
          taskCount={
            data.tasks.filter((t) => t.project === modal.project.id).length
          }
          onClose={closeModal}
          onDelete={(target) => {
            const id = modal.project.id;
            mutate((current) => ({
              ...current,
              projects: current.projects.filter((p) => p.id !== id),
              tasks: current.tasks.map((t) =>
                t.project === id ? { ...t, project: target } : t,
              ),
            }));
            if (projectFilter === id) setProjectFilter("");
            closeModal();
          }}
        />
      )}
      {modal?.kind === "settings" && (
        <Dialog
          title={clean("Настройки этого цирка")}
          onClose={closeModal}
          className="settings-dialog"
        >
          <p>{clean("Пиздец не отключается. А тему поменять можно.")}</p>
          <div className="setting-row">
            <span>
              Оформление<small>Дневная или ночная кошка</small>
            </span>
            <button className="theme-setting-button" onClick={toggleTheme}>
              {data.settings.theme === "dark"
                ? "☾ Ночная кошка"
                : "☀ Дневная кошка"}
            </button>
          </div>
          <div className="setting-row">
            <span>
              Лексика<small>Для созвонов, коллег и демонстраций</small>
            </span>
            <button className="theme-setting-button" onClick={toggleLanguage}>
              {data.settings.cleanLanguage ? "Без мата" : "Мат включён"}
            </button>
          </div>
          <div className="setting-row">
            <span>
              Сохранение
              <small>
                {isDesktop()
                  ? "На этом компьютере · автоматически"
                  : "В этом браузере · автоматически"}
              </small>
            </span>
            <span
              className={`badge ${saveState === "error" ? "yellow" : "green"}`}
            >
              {saveLabels[saveState]}
            </span>
          </div>
          {saveError && (
            <div className="modal-error" role="alert">
              <p>{saveError}</p>
              <button
                className="secondary-btn"
                onClick={() => void flush().catch(() => {})}
              >
                Повторить сохранение
              </button>
            </div>
          )}
          <div className="backup-section">
            <h3>Резервная копия</h3>
            <p>
              Сохраните задачи, проекты, комментарии, файлы и настройки в JSON.
              Импорт заменяет текущее пространство.
            </p>
            <div className="backup-actions">
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => void doExport()}
              >
                <Download className="icon" />
                Экспорт JSON
              </button>
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => {
                  setOperationError("");
                  setModal({ kind: "import" });
                }}
              >
                <Upload className="icon" />
                Импорт JSON
              </button>
            </div>
            {storageInfo && (
              <details className="storage-details">
                <summary>Где хранятся данные</summary>
                <p>{storageInfo.path}</p>
                <p>Резервные копии: {storageInfo.backupDirectory}</p>
              </details>
            )}
          </div>
          <div className="backup-section">
            <h3>Начать заново</h3>
            <p>Очистить задачи, проекты и достижения на этом устройстве.</p>
            <button
              className="danger-btn"
              disabled={busy}
              onClick={() => {
                setOperationError("");
                setModal({ kind: "reset" });
              }}
            >
              <Trash2 className="icon" />
              Сбросить данные
            </button>
          </div>
          <Shortcuts />
          <div className="modal-footer">
            <span>потом. · Лапки есть. ТЗ нет.</span>
            <button className="primary-btn" onClick={closeModal}>
              Мяу. Понятно.
            </button>
          </div>
          {operationError && (
            <p className="modal-error" role="alert">
              {operationError}
            </p>
          )}
        </Dialog>
      )}
      {modal?.kind === "import" && (
        <Dialog title="Восстановить резервную копию?" onClose={closeModal}>
          <p>
            Задачи, проекты, комментарии, файлы и настройки будут заменены
            данными из выбранного JSON. Сначала можно экспортировать текущее
            пространство.
          </p>
          <div className="backup-actions">
            <button
              className="secondary-btn"
              disabled={busy}
              onClick={() => void doExport()}
            >
              <Download className="icon" />
              Сохранить текущее
            </button>
          </div>
          {operationError && (
            <p className="modal-error" role="alert">
              {operationError}
            </p>
          )}
          <div className="modal-footer">
            <button className="secondary-btn" onClick={closeModal}>
              Отмена
            </button>
            <button
              className="primary-btn"
              disabled={busy}
              onClick={() => void doImport()}
            >
              {busy ? "Подождите…" : "Выбрать и восстановить JSON"}
            </button>
          </div>
        </Dialog>
      )}
      {resetDialog}
      {modal?.kind === "help" && (
        <Dialog title="Лапки есть. Инструкция тоже." onClose={closeModal}>
          <p>
            Личный планнер без регистрации и обязательного интернета. Задачи,
            канбан, календарь, комментарии и файлы живут в одном пространстве.
          </p>
          <Shortcuts />
          <p>
            Режим «День» показывает семь дней с выбранной даты, включая
            выполненные задачи. Отложенная задача теряет срок, а выполненная
            отмечает весь чеклист.
          </p>
          <p>Резервные копии можно сохранить и восстановить в настройках.</p>
          <div className="modal-footer">
            <span>потом. · v0.1.0</span>
            <button className="primary-btn" onClick={closeModal}>
              Всё понятно
            </button>
          </div>
        </Dialog>
      )}
      {modal?.kind === "profile" && (
        <Dialog title="Моё пространство" onClose={closeModal}>
          <p>Личный штаб по разбору чужих гениальных идей.</p>
          <div className="setting-row">
            <span>
              Личное пространство
              <small>
                {data.projects.length} проектов · {data.tasks.length} задач
              </small>
            </span>
            <span className="badge pink">Это ты</span>
          </div>
          <div className="setting-row">
            <span>Закрыто задач</span>
            <b>{data.tasks.filter((t) => t.status === "done").length}</b>
          </div>
          <div className="setting-row">
            <span>Открыто достижений</span>
            <b>
              {data.unlocked.length} / {achievements.length}
            </b>
          </div>
          <div className="modal-footer">
            <span>Лапки есть. Телепатии нет.</span>
            <button className="primary-btn" onClick={closeModal}>
              Вернуться к планам ↗
            </button>
          </div>
        </Dialog>
      )}
      <div className={`toast ${toast ? "show" : ""}`} role="status">
        {toast}
      </div>
    </>
  );
}

function ResetData({
  busy,
  error,
  onClose,
  onReset,
}: {
  busy: boolean;
  error: string;
  onClose: () => void;
  onReset: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation.trim() === "СБРОСИТЬ";
  return (
    <Dialog title="Начать с чистого листа?" onClose={onClose}>
      <p>
        Все задачи, проекты, комментарии и файлы исчезнут из текущего
        пространства. Достижения и настройки вернутся к начальному состоянию.
      </p>
      <p>
        Перед сбросом сохраним резервную копию <b>before-reset</b> в папке
        резервных копий.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmed && !busy) onReset();
        }}
      >
        <div className="form-field">
          <label htmlFor="reset-confirmation">
            Для подтверждения введите СБРОСИТЬ
          </label>
          <input
            id="reset-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            data-autofocus
          />
        </div>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="secondary-btn"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="danger-btn"
            disabled={!confirmed || busy}
          >
            <Trash2 className="icon" />
            {busy ? "Сбрасываем…" : "Сбросить данные"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Shortcuts() {
  return (
    <div className="shortcuts">
      {[
        ["Найти задачу", "⌘ / Ctrl + K"],
        ["Новая задача", "N"],
        ["Закрыть окно", "Esc"],
        ["Жирный / курсив", "⌘ / Ctrl + B / I"],
      ].map(([name, keys]) => (
        <div className="shortcut" key={name}>
          <span>{name}</span>
          <kbd>{keys}</kbd>
        </div>
      ))}
    </div>
  );
}
function NewTaskForm({
  projects,
  initialProject,
  initialStatus,
  initialDue,
  onClose,
  onCreate,
}: {
  projects: Project[];
  initialProject?: string;
  initialStatus: Status;
  initialDue: string;
  onClose: () => void;
  onCreate: (
    task: Pick<
      Task,
      "title" | "project" | "status" | "due" | "priority" | "description"
    >,
    firstProjectName?: string,
  ) => void;
}) {
  const [title, setTitle] = useState(""),
    [project, setProject] = useState(initialProject || ""),
    [firstProjectName, setFirstProjectName] = useState(""),
    [due, setDue] = useState(initialDue),
    [description, setDescription] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      !title.trim() ||
      (projects.length ? !project : !firstProjectName.trim())
    )
      return;
    onCreate(
      {
        title: title.trim(),
        project,
        status: initialStatus,
        due,
        priority: "normal",
        description: description.trim(),
      },
      projects.length ? undefined : firstProjectName.trim(),
    );
  };
  return (
    <Dialog title="Что у нас в планах?" onClose={onClose}>
      <p>Запиши, пока это не превратилось в ещё один созвон.</p>
      <form onSubmit={submit}>
        <div className="form-field">
          <label htmlFor="new-title">Название задачи</label>
          <input
            id="new-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={160}
            placeholder="Например, выбить из бизнеса нормальное ТЗ"
            autoComplete="off"
            data-autofocus
          />
        </div>
        <div className="form-pair">
          <div className="form-field">
            <label htmlFor="new-project">
              {projects.length ? "Проект" : "Название проекта"}
            </label>
            {projects.length ? (
              <select
                id="new-project"
                value={project}
                required
                onChange={(e) => setProject(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="new-project"
                value={firstProjectName}
                required
                maxLength={100}
                placeholder="Например, Личное"
                onChange={(e) => setFirstProjectName(e.target.value)}
              />
            )}
          </div>
          <div className="form-field">
            <label htmlFor="new-due">Крайний срок</label>
            <input
              id="new-due"
              type="date"
              value={initialStatus === "deferred" ? "" : due}
              disabled={initialStatus === "deferred"}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="new-description">
            Описание · Markdown поддерживается
          </label>
          <textarea
            id="new-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Немного контекста. Можно **жирным**."
          />
        </div>
        <div className="modal-footer">
          <span>Без срока? Так и запишем: срока нет.</span>
          <button
            className="primary-btn"
            type="submit"
            disabled={
              !title.trim() ||
              (projects.length ? !project : !firstProjectName.trim())
            }
          >
            <Plus className="icon" />
            Создать задачу
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function ProjectForm({
  project,
  onClose,
  onSave,
  onDelete,
}: {
  project?: Project;
  onClose: () => void;
  onSave: (name: string, color: string) => void;
  onDelete: (p: Project) => void;
}) {
  const [name, setName] = useState(project?.name || ""),
    [color, setColor] = useState(project?.color || "#dba4bd");
  return (
    <Dialog
      title={project ? "Настройки проекта" : "Новое место для идей"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim(), color);
        }}
      >
        <div className="form-field">
          <label htmlFor="project-name">Название проекта</label>
          <input
            id="project-name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            required
            data-autofocus
            placeholder="Например, Большое приключение"
          />
        </div>
        <div className="form-field">
          <label htmlFor="project-color">Цвет проекта</label>
          <div className="color-options">
            {[
              "#dba4bd",
              "#d8c375",
              "#a5b39c",
              "#b8afcf",
              "#dfb29a",
              "#83b9c2",
            ].map((c) => (
              <button
                key={c}
                type="button"
                style={{ background: c }}
                aria-label={`Цвет ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              >
                {color === c && <Check size={16} />}
              </button>
            ))}
            <input
              id="project-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Свой цвет проекта"
            />
          </div>
        </div>
        <div className="modal-footer">
          {project ? (
            <button
              type="button"
              className="text-danger"
              onClick={() => onDelete(project)}
            >
              Удалить проект
            </button>
          ) : (
            <span>У идей будет свой кабинет.</span>
          )}
          <button className="primary-btn" type="submit" disabled={!name.trim()}>
            {project ? "Сохранить" : "Создать проект"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function DeleteProject({
  project,
  projects,
  taskCount,
  onClose,
  onDelete,
}: {
  project: Project;
  projects: Project[];
  taskCount: number;
  onClose: () => void;
  onDelete: (target: string) => void;
}) {
  const others = projects.filter((p) => p.id !== project.id),
    [target, setTarget] = useState(others[0]?.id || "");
  return (
    <Dialog title="Удалить проект?" onClose={onClose}>
      <p>
        Проект «{project.name}» будет удалён.
        {taskCount > 0
          ? ` Задачи (${taskCount}) с комментариями и файлами сохранятся в другом проекте.`
          : ""}
      </p>
      {taskCount > 0 && (
        <div className="form-field">
          <label htmlFor="move-project">Перенести задачи в</label>
          <select
            id="move-project"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {others.length === 0 && (
        <p>Это единственный проект. Сначала создайте другой проект.</p>
      )}
      <div className="modal-footer">
        <button className="secondary-btn" onClick={onClose}>
          Оставить
        </button>
        <button
          className="danger-btn"
          disabled={!others.length || (taskCount > 0 && !target)}
          onClick={() => onDelete(target)}
        >
          Удалить проект
        </button>
      </div>
    </Dialog>
  );
}
