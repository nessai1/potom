import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { AppData } from "../types";
import { percent } from "../model/tasks";
import { isDesktop } from "./storage";

export interface QuickTask {
  id: number;
  title: string;
  projectName: string;
  projectColor: string;
  due: string;
  progress: number;
}

export interface QuickTasksSnapshot {
  tasks: QuickTask[];
  theme: "light" | "dark";
  cleanLanguage: boolean;
}

export function quickTasksSnapshot(data: AppData): QuickTasksSnapshot {
  return {
    tasks: data.tasks
      .filter((task) => task.status === "progress")
      .map((task) => {
        const project = data.projects.find((item) => item.id === task.project);
        return {
          id: task.id,
          title: task.title,
          projectName: project?.name || "Без проекта",
          projectColor: project?.color || "#b7678e",
          due: task.due,
          progress: percent(task),
        };
      }),
    theme: data.settings.theme,
    cleanLanguage: data.settings.cleanLanguage,
  };
}

type Message =
  | { type: "state"; snapshot: QuickTasksSnapshot }
  | { type: "request" }
  | { type: "open"; id: number };
interface Handlers {
  onState?: (snapshot: QuickTasksSnapshot) => void;
  onRequest?: () => void;
  onOpen?: (id: number) => void;
  onExpanded?: (expanded: boolean) => void;
}

let browserChannel: BroadcastChannel | undefined;
const channel = () =>
  (browserChannel ??= new BroadcastChannel("potom:quick-tasks"));

/** The main window owns all mutations; the floating window only reads snapshots. */
export async function listenQuickTasks(
  handlers: Handlers,
): Promise<() => void> {
  if (!isDesktop()) {
    const receive = ({ data }: MessageEvent<Message>) => {
      if (data.type === "state") handlers.onState?.(data.snapshot);
      if (data.type === "request") handlers.onRequest?.();
      if (data.type === "open") handlers.onOpen?.(data.id);
    };
    channel().addEventListener("message", receive);
    return () => channel().removeEventListener("message", receive);
  }
  const stops: Array<() => void> = [];
  try {
    if (handlers.onState)
      stops.push(
        await listen<QuickTasksSnapshot>("potom:state-changed", ({ payload }) =>
          handlers.onState?.(payload),
        ),
      );
    if (handlers.onRequest)
      stops.push(
        await listen("potom:request-state", () => handlers.onRequest?.()),
      );
    if (handlers.onOpen)
      stops.push(
        await listen<number>("potom:open-task", ({ payload }) =>
          handlers.onOpen?.(payload),
        ),
      );
    if (handlers.onExpanded)
      stops.push(
        await listen<boolean>("potom:quick-expanded", ({ payload }) =>
          handlers.onExpanded?.(payload),
        ),
      );
    return () => stops.forEach((stop) => stop());
  } catch (error) {
    stops.forEach((stop) => stop());
    throw error;
  }
}

export async function publishQuickTasks(snapshot: QuickTasksSnapshot) {
  if (isDesktop()) await emitTo("quick-tasks", "potom:state-changed", snapshot);
  else channel().postMessage({ type: "state", snapshot } satisfies Message);
}

export async function requestQuickTasks() {
  if (isDesktop()) await emitTo("main", "potom:request-state");
  else channel().postMessage({ type: "request" } satisfies Message);
}

export async function openQuickTask(id: number) {
  if (isDesktop()) await invoke("open_quick_task", { id });
  else channel().postMessage({ type: "open", id } satisfies Message);
}

export async function resizeQuickTasks(expanded: boolean) {
  if (isDesktop()) await invoke("set_quick_tasks_expanded", { expanded });
}
