import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  type PointerSensorProps,
} from "@dnd-kit/core";
import {
  Check,
  Plus,
  ListChecks,
  CalendarDays,
  Sparkles,
  ArrowDownToLine,
} from "lucide-react";
import type { Project, Status, Task } from "../types";
import {
  doneCount,
  percent,
  statusColumns,
  isUrgent,
  taskId,
} from "../model/tasks";
import { shortDate } from "../model/dates";
import "../styles/board-layout.css";

interface Props {
  tasks: Task[];
  projects: Project[];
  onOpen: (id: number) => void;
  onMove: (id: number, status: Status) => void;
  onNew: (status?: Status) => void;
  onDone: () => void;
  clean: (s: string) => string;
}
// WebKit can deliver activation and release before React commits the drag state.
// Commit once at pickup so dnd-kit can always finish even a very fast gesture.
class BoardPointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    super({
      ...props,
      onStart: (coordinates) => flushSync(() => props.onStart(coordinates)),
    });
  }
}

const columnId = (status: Status) => `column:${status}`;
const columnStatus = (id: string | number | undefined): Status | null =>
  statusColumns.find(([status]) => columnId(status) === id)?.[0] ?? null;
const columnName = (status: Status | null) =>
  statusColumns.find(([key]) => key === status)?.[1];

// A pointer released outside the board must cancel, rather than pick the nearest column.
const collisions: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

const keyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.code)) return undefined;
  const { active, over, collisionRect, droppableRects, droppableContainers } =
    context;
  if (!active || !collisionRect) return undefined;
  event.preventDefault();
  const current =
    columnStatus(over?.id) ?? (active.data.current?.status as Status);
  const index = statusColumns.findIndex(([status]) => status === current);
  const next = statusColumns[index + (event.code === "ArrowRight" ? 1 : -1)];
  if (!next) return currentCoordinates;
  const id = columnId(next[0]);
  const rect = droppableRects.get(id);
  if (!rect) return undefined;
  droppableContainers
    .get(id)
    ?.node.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  return {
    x:
      currentCoordinates.x +
      rect.left +
      rect.width / 2 -
      (collisionRect.left + collisionRect.width / 2),
    y:
      currentCoordinates.y +
      rect.top +
      Math.min(rect.height / 2, 140) -
      (collisionRect.top + collisionRect.height / 2),
  };
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function CardContents({ task, project }: { task: Task; project?: Project }) {
  return (
    <>
      <span className="task-id">
        {task.status === "done" ? "✓ " : ""}
        {taskId(task)}
      </span>
      <h3>{task.title}</h3>
      <span className="kanban-project">
        <span
          className="project-dot"
          style={{ background: project?.color, width: 5, height: 5 }}
        />
        {project?.name || "Без проекта"}
      </span>
      <div className="progress-track">
        <div
          className={`progress-fill ${task.status === "done" ? "complete" : ""}`}
          style={{ width: `${percent(task)}%` }}
        />
      </div>
      <div className="kanban-card-footer">
        <span>
          <ListChecks className="icon" />
          {doneCount(task)}/{task.checklist.length}
        </span>
        <span>
          {task.due ? (
            <>
              <CalendarDays className="icon" />
              {shortDate(task.due)}
            </>
          ) : (
            "Срока нет"
          )}
        </span>
      </div>
    </>
  );
}

function DraggableCard({
  task,
  project,
  onOpen,
  suppressClick,
  landing,
}: {
  task: Task;
  project?: Project;
  onOpen: (id: number) => void;
  suppressClick: () => boolean;
  landing: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status, title: task.title },
  });
  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`kanban-card ${isUrgent(task) ? "urgent" : task.status === "done" ? "card-done" : ""} ${isDragging ? "is-dragging" : ""} ${landing ? "is-landing" : ""}`}
      data-task-id={task.id}
      aria-label={`Открыть ${task.title}`}
      aria-roledescription="перетаскиваемая задача"
      aria-keyshortcuts="Enter Space"
      onClick={(event) => {
        if (suppressClick()) {
          event.preventDefault();
          return;
        }
        onOpen(task.id);
      }}
      onKeyDown={(event) => {
        if (event.code === "Enter" && !isDragging) {
          event.preventDefault();
          onOpen(task.id);
          return;
        }
        listeners?.onKeyDown?.(event);
      }}
    >
      <CardContents task={task} project={project} />
    </article>
  );
}

function Column({
  status,
  label,
  count,
  active,
  over,
  onNew,
  children,
}: {
  status: Status;
  label: string;
  count: number;
  active: boolean;
  over: boolean;
  onNew: (status?: Status) => void;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: columnId(status) });
  return (
    <section
      ref={setNodeRef}
      className={`kanban-col ${count === 0 ? "is-empty" : ""} ${over ? "dragover" : ""} ${active ? "is-drag-active" : ""}`}
      data-status={status}
      aria-label={label}
    >
      <div className="kanban-heading">
        <span className="status-dot" />
        {label}
        <small>{count}</small>
        <button
          className="icon-btn"
          onClick={() => onNew(status)}
          aria-label={`Добавить задачу: ${label}`}
        >
          <Plus className="icon" />
        </button>
      </div>
      {children}
      <button className="kanban-add" onClick={() => onNew(status)}>
        <Plus className="icon" />
        Добавить задачу
      </button>
      <div className="kanban-drop-hint" aria-hidden="true">
        <ArrowDownToLine className="icon" />
        Отпусти здесь
      </div>
    </section>
  );
}

export default function BoardView({
  tasks,
  projects,
  onOpen,
  onMove,
  onNew,
  onDone,
  clean,
}: Props) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [overStatus, setOverStatus] = useState<Status | null>(null);
  const [landingId, setLandingId] = useState<number | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const pointerDropStatus = useRef<Status | null | undefined>(undefined);
  const pointerDrag = useRef(false);
  const previousRects = useRef(new Map<number, DOMRect>());
  const suppressUntil = useRef(0);
  const landingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();
  const activeTask = tasks.find((task) => task.id === activeId);
  const sensors = useSensors(
    useSensor(BoardPointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
      coordinateGetter: keyboardCoordinates,
      scrollBehavior: "auto",
    }),
  );
  const layoutKey = tasks.map((task) => `${task.id}:${task.status}`).join("|");
  const captureRects = () =>
    new Map(
      Array.from(
        board.current?.querySelectorAll<HTMLElement>(".kanban-card") ?? [],
      ).map((node) => [
        Number(node.dataset.taskId),
        node.getBoundingClientRect(),
      ]),
    );
  useLayoutEffect(() => {
    const next = captureRects();
    if (!reducedMotion) {
      board.current
        ?.querySelectorAll<HTMLElement>(".kanban-card")
        .forEach((node) => {
          const id = Number(node.dataset.taskId);
          const before = previousRects.current.get(id),
            after = next.get(id);
          if (!before || !after || id === landingId) return;
          const x = before.left - after.left,
            y = before.top - after.top;
          if (Math.abs(x) > 1 || Math.abs(y) > 1)
            node.animate(
              [
                { transform: `translate(${x}px, ${y}px)` },
                { transform: "translate(0, 0)" },
              ],
              { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" },
            );
        });
    }
    previousRects.current = next;
  }, [layoutKey, reducedMotion, landingId]);
  useEffect(
    () => () => {
      if (landingTimer.current) clearTimeout(landingTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (activeId === null) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [activeId]);

  // The first move can both activate a drag and release over another column.
  // Sensor collision state may still describe the source on that frame, so use
  // the actual release point, captured before dnd-kit's pointer-up listener.
  useEffect(() => {
    const released = (event: PointerEvent) => {
      const column = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>(".kanban-col");
      pointerDropStatus.current =
        column && board.current?.contains(column)
          ? (column.dataset.status as Status)
          : null;
    };
    document.addEventListener("pointerup", released, true);
    return () => document.removeEventListener("pointerup", released, true);
  }, []);

  const dropTarget = (event: Pick<DragEndEvent, "over">) =>
    !pointerDrag.current || pointerDropStatus.current === undefined
      ? columnStatus(event.over?.id)
      : pointerDropStatus.current;

  const reset = () => {
    suppressUntil.current = performance.now() + 250;
    setActiveId(null);
    setOverStatus(null);
  };
  const finish = (event: DragEndEvent) => {
    const { active } = event;
    const target = dropTarget(event);
    const task = tasks.find((task) => task.id === active.id);
    if (task && target && target !== task.status) {
      setLandingId(task.id);
      if (landingTimer.current) clearTimeout(landingTimer.current);
      landingTimer.current = setTimeout(() => setLandingId(null), 720);
      onMove(task.id, target);
    }
    reset();
  };

  return (
    <>
      <div className="page-top">
        <div>
          <h1>Доска разруливания</h1>
          <p>От «там на пять минут» до «слава богу, закрыла».</p>
        </div>
        <button className="primary-btn" onClick={() => onNew()}>
          <Plus className="icon" />
          Новая задача
        </button>
      </div>
      <div className={`board-toolbar ${activeTask ? "is-dragging" : ""}`}>
        <p>
          {activeTask
            ? overStatus
              ? `Перенести в «${columnName(overStatus)}»`
              : "Выбери колонку · Esc — отменить"
            : "Двигай карточки. Пусть хоть что-нибудь двигается."}
        </p>
        <button className="secondary-btn" onClick={onDone}>
          <Check className="icon" />
          Готово{" "}
          <span>{tasks.filter((task) => task.status === "done").length}</span>
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisions}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Enter открывает задачу. Пробел поднимает карточку, стрелки влево и вправо выбирают колонку, пробел или Enter завершают перенос. Escape отменяет перенос.",
          },
          announcements: {
            onDragStart: ({ active }) =>
              `Поднята задача «${active.data.current?.title}». Выберите колонку стрелками.`,
            onDragOver: ({ over }) =>
              over
                ? `Колонка «${columnName(columnStatus(over.id))}».`
                : "За пределами доски. Отпустите, чтобы отменить перенос.",
            onDragEnd: (event) => {
              const target = dropTarget(event);
              return target
                ? `Задача перенесена в «${columnName(target)}».`
                : "Перенос отменён.";
            },
            onDragCancel: () => "Перенос отменён.",
          },
        }}
        onDragStart={({ active, activatorEvent }) => {
          pointerDrag.current = activatorEvent.type !== "keydown";
          pointerDropStatus.current = undefined;
          previousRects.current = captureRects();
          setActiveId(Number(active.id));
          setOverStatus(active.data.current?.status ?? null);
        }}
        onDragOver={({ over }) => setOverStatus(columnStatus(over?.id))}
        onDragEnd={finish}
        onDragCancel={reset}
      >
        <div
          ref={board}
          className={`board kanban-board ${activeTask ? "is-dragging" : ""}`}
        >
          {statusColumns.map(([status, label]) => (
            <Column
              key={status}
              status={status}
              label={label}
              count={tasks.filter((task) => task.status === status).length}
              active={!!activeTask}
              over={!!activeTask && overStatus === status}
              onNew={onNew}
            >
              {tasks
                .filter((task) => task.status === status)
                .map((task) => (
                  <DraggableCard
                    key={task.id}
                    task={task}
                    project={projects.find(
                      (project) => project.id === task.project,
                    )}
                    onOpen={onOpen}
                    suppressClick={() =>
                      performance.now() < suppressUntil.current
                    }
                    landing={landingId === task.id}
                  />
                ))}
            </Column>
          ))}
        </div>
        {createPortal(
          <DragOverlay
            adjustScale={false}
            style={{ pointerEvents: "none" }}
            zIndex={90}
            dropAnimation={
              reducedMotion
                ? null
                : {
                    duration: 320,
                    easing: "cubic-bezier(.22,1,.36,1)",
                    sideEffects: defaultDropAnimationSideEffects({
                      styles: { active: { opacity: "0" } },
                    }),
                  }
            }
          >
            {activeTask ? (
              <div className="kanban-drag-preview" aria-hidden="true">
                <article
                  className={`kanban-card ${isUrgent(activeTask) ? "urgent" : activeTask.status === "done" ? "card-done" : ""}`}
                >
                  <CardContents
                    task={activeTask}
                    project={projects.find(
                      (project) => project.id === activeTask.project,
                    )}
                  />
                </article>
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      <div className="list-footnote">
        <Sparkles className="icon" />
        {clean("«Выполнено» — красивое слово. Особенно в пятницу.")}
      </div>
    </>
  );
}
