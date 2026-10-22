export type Status = "created" | "progress" | "deferred" | "done";
export type Priority = "high" | "normal" | "low";
export type SaveState = "loading" | "saving" | "saved" | "error";
export interface ChecklistItem {
  text: string;
  done: boolean;
  wasUnchecked?: boolean;
}
export interface TaskNote {
  id: number;
  text: string;
  date: string;
  title?: string;
}
export interface TaskAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  data: string;
  added: string;
}
export interface Task {
  id: number;
  title: string;
  project: string;
  status: Status;
  due: string;
  priority: Priority;
  description: string;
  checklist: ChecklistItem[];
  notes: TaskNote[];
  commentDraft?: string;
  attachments?: TaskAttachment[];
  created: string;
  completedAt?: string;
  completedAtTime?: number;
  archived?: boolean;
}
export interface Project {
  id: string;
  name: string;
  color: string;
}
export interface Settings {
  theme: "light" | "dark";
  cleanLanguage: boolean;
}
export interface Metrics {
  [key: string]: number | Record<string, number> | undefined;
  descriptionEdits?: Record<string, number>;
}
export interface AppData {
  schema: 2;
  tasks: Task[];
  projects: Project[];
  unlocked: string[];
  metrics: Metrics;
  settings: Settings;
}
export type UpdateTask = (id: number, update: (task: Task) => Task) => void;
export interface TaskDetailProps {
  task: Task;
  projects: Project[];
  cleanLanguage: boolean;
  saveState: SaveState;
  onUpdate: UpdateTask;
  onClose: () => void;
  onDuplicate: (id: number) => void;
  onDelete: (id: number) => void;
  onEvent: (name: string) => void;
  onAddAttachments: (id: number, files: File[]) => Promise<void>;
}
