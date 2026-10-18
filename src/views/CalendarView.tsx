import { useState } from "react";
import { CalendarDays, ChevronRight, Clock, Flag, Plus } from "lucide-react";
import type { Project, Task } from "../types";
import {
  todayKey,
  parseDate,
  longDate,
  rangeLabel,
  weekDates,
  monthDates,
  shiftMonth,
  addDays,
  plural,
} from "../model/dates";
import {
  doneCount,
  percent,
  taskId,
  tasksOnDate,
  upcomingGroups,
} from "../model/tasks";
import { Badge, Cat } from "../components/TaskVisuals";
type Mode = "month" | "week" | "day";
interface Props {
  tasks: Task[];
  projects: Project[];
  onOpen: (id: number) => void;
  onNew: (due: string) => void;
}
export default function CalendarView({
  tasks,
  projects,
  onOpen,
  onNew,
}: Props) {
  const today = todayKey(),
    [mode, setMode] = useState<Mode>("month"),
    [selected, setSelected] = useState(today);
  const week = weekDates(selected),
    month = monthDates(selected),
    date = parseDate(selected),
    groups = upcomingGroups(tasks, selected),
    selectedTasks = tasksOnDate(tasks, selected),
    count = groups.reduce((n, g) => n + g.tasks.length, 0);
  let title =
    mode === "month"
      ? date
          .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
          .replace(" г.", "")
      : mode === "week"
        ? rangeLabel(week[0], week[6])
        : rangeLabel(selected);
  title = title.charAt(0).toUpperCase() + title.slice(1);
  const shift = (amount: number) =>
    setSelected(
      mode === "month"
        ? shiftMonth(selected, amount)
        : addDays(selected, amount * (mode === "week" ? 7 : 1)),
    );
  const card = (t: Task, compact = false) => {
    const p = projects.find((p) => p.id === t.project);
    return (
      <button
        key={t.id}
        className={`cal-task-card ${compact ? "compact" : ""} ${t.status === "done" ? "is-done" : ""}`}
        onClick={() => onOpen(t.id)}
        aria-label={`Открыть задачу: ${t.title}`}
      >
        <span className="cal-task-card-top">
          <span className="cal-task-project">
            <i className="project-dot" style={{ background: p?.color }} />
            {p?.name}
          </span>
          <span className="cal-task-id">{taskId(t)}</span>
        </span>
        <strong className="cal-task-card-title">{t.title}</strong>
        <span className="cal-task-card-status">
          <Badge task={t} />
          {t.priority === "high" && (
            <span className="cal-high-priority">
              <Flag className="icon" />
              Высокий
            </span>
          )}
        </span>
        <span className="cal-task-card-bottom">
          <span>
            {t.checklist.length
              ? `${doneCount(t)} из ${t.checklist.length} пунктов`
              : "Без чеклиста"}
          </span>
          {!!t.checklist.length && <b>{percent(t)}%</b>}
        </span>
        {!!t.checklist.length && (
          <span className="cal-card-progress">
            <i style={{ width: `${percent(t)}%` }} />
          </span>
        )}
      </button>
    );
  };
  const openDay = (key: string) => {
    setSelected(key);
    setMode("day");
  };
  const undated = tasks.filter((t) => !t.due && t.status !== "done").length;
  return (
    <>
      <div className="page-top">
        <div>
          <h1>Календарь</h1>
          <p>У каждой паники есть дата.</p>
        </div>
        <button className="primary-btn" onClick={() => onNew(selected)}>
          <Plus className="icon" />
          Новая задача
        </button>
      </div>
      <div className="cal-view-controls">
        <div className="cal-period-navigation">
          <button
            className="cal-nav-arrow"
            onClick={() => shift(-1)}
            aria-label={`Назад на ${mode === "month" ? "месяц" : mode === "week" ? "неделю" : "день"}`}
          >
            <ChevronRight className="icon" />
          </button>
          <button
            className="cal-nav-arrow"
            onClick={() => shift(1)}
            aria-label={`Вперёд на ${mode === "month" ? "месяц" : mode === "week" ? "неделю" : "день"}`}
          >
            <ChevronRight className="icon" />
          </button>
          <h2>{title}</h2>
          <button
            className="cal-today-button"
            onClick={() => setSelected(today)}
          >
            Сегодня
          </button>
        </div>
        <div
          className="cal-mode-switch"
          role="group"
          aria-label="Вид календаря"
        >
          {(
            [
              ["month", "Месяц"],
              ["week", "Неделя"],
              ["day", "День"],
            ] as const
          ).map(([key, label]) => (
            <button
              className={mode === key ? "active" : ""}
              key={key}
              aria-pressed={mode === key}
              onClick={() => {
                if (key === "day" && mode !== "day") setSelected(today);
                setMode(key);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="cal-view-meta">
        <span>
          <CalendarDays className="icon" />
          По крайнему сроку задачи
        </span>
        <label className="cal-date-jump">
          К дате
          <input
            type="date"
            value={selected}
            onChange={(e) => {
              if (e.target.value && e.target.validity.valid)
                setSelected(e.target.value);
            }}
            aria-label="Выбрать дату календаря"
          />
        </label>
      </div>
      {mode === "month" && (
        <>
          <div className="cal-month-grid" aria-label="Календарь на месяц">
            {["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"].map((day, i) => (
              <div
                className={`cal-weekday ${i > 4 ? "weekend" : ""}`}
                key={day}
              >
                {day}
              </div>
            ))}
            {month.map((key, i) => {
              const d = parseDate(key),
                dayTasks = tasksOnDate(tasks, key);
              return (
                <section
                  key={key}
                  className={`cal-month-day ${d.getMonth() !== date.getMonth() ? "other-month" : ""} ${i % 7 > 4 ? "weekend" : ""} ${key === today ? "is-today" : ""} ${key === selected ? "is-selected" : ""}`}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setSelected(key);
                  }}
                >
                  <button
                    className="cal-month-date"
                    onClick={() => setSelected(key)}
                    aria-pressed={key === selected}
                    aria-label={`${longDate(key)}, ${dayTasks.length} ${plural(dayTasks.length)}`}
                  >
                    <span>{d.getDate()}</span>
                    {!!dayTasks.length && <small>{dayTasks.length}</small>}
                  </button>
                  <div className="cal-month-events">
                    {dayTasks.slice(0, 3).map((t) => (
                      <button
                        key={t.id}
                        className={`cal-month-event ${t.status === "done" ? "is-done" : t.project === "work" ? "is-yellow" : ""}`}
                        onClick={() => onOpen(t.id)}
                        title={t.title}
                      >
                        {t.status === "done" ? "✓ " : ""}
                        {t.title}
                      </button>
                    ))}
                  </div>
                  {dayTasks.length > 3 && (
                    <button
                      className="cal-month-more"
                      onClick={() => openDay(key)}
                    >
                      Ещё {dayTasks.length - 3}
                      <ChevronRight className="icon" />
                    </button>
                  )}
                </section>
              );
            })}
          </div>
          <section className="cal-selected-panel">
            <div className="cal-selected-heading">
              <div>
                <span className="cal-eyebrow">ВЫБРАННЫЙ ДЕНЬ</span>
                <h2>{longDate(selected)}</h2>
              </div>
              <div className="selected-day-actions">
                <button
                  className="secondary-btn"
                  onClick={() => onNew(selected)}
                >
                  <Plus className="icon" />
                  Задача
                </button>
                <button
                  className="secondary-btn"
                  onClick={() => openDay(selected)}
                >
                  Открыть день
                  <ChevronRight className="icon" />
                </button>
              </div>
            </div>
            {selectedTasks.length ? (
              <div className="cal-selected-list">
                {selectedTasks.map((t) => (
                  <button
                    className="cal-selected-task"
                    key={t.id}
                    onClick={() => onOpen(t.id)}
                  >
                    <span>{t.title}</span>
                    <Badge task={t} />
                    <ChevronRight className="icon" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="cal-selected-empty">
                На эту дату сроков нет. В календаре тихо.
              </p>
            )}
          </section>
        </>
      )}
      {mode === "week" && (
        <div
          className="cal-week-scroll"
          tabIndex={0}
          aria-label="Неделя: семь дней, задачи без привязки ко времени"
        >
          <div className="cal-week-grid">
            {week.map((key, i) => {
              const d = parseDate(key),
                dayTasks = tasksOnDate(tasks, key);
              return (
                <section
                  key={key}
                  className={`cal-week-column ${i > 4 ? "weekend" : ""} ${key === today ? "is-today" : ""} ${key === selected ? "is-selected" : ""}`}
                >
                  <button
                    className="cal-week-date"
                    onClick={() => setSelected(key)}
                    aria-pressed={key === selected}
                    aria-label={`Выбрать ${longDate(key)}`}
                  >
                    <span>
                      {d.toLocaleDateString("ru-RU", { weekday: "short" })}
                    </span>
                    <strong>{d.getDate()}</strong>
                    <small>
                      {key === today
                        ? "Сегодня"
                        : d
                            .toLocaleDateString("ru-RU", { month: "short" })
                            .replace(".", "")}
                    </small>
                  </button>
                  <div className="cal-all-day">
                    <span>Весь день</span>
                    <b>{dayTasks.length}</b>
                  </div>
                  <div className="cal-week-tasks">
                    {dayTasks.length ? (
                      dayTasks.map((t) => card(t, true))
                    ) : (
                      <span className="cal-week-empty">
                        Сроков нет.
                        <br />
                        Пока.
                      </span>
                    )}
                  </div>
                  <button
                    className="cal-week-add"
                    onClick={() => onNew(key)}
                    aria-label={`Добавить задачу на ${longDate(key)}`}
                  >
                    <Plus className="icon" />
                    Задача
                  </button>
                </section>
              );
            })}
          </div>
        </div>
      )}
      {mode === "day" && (
        <section className="cal-day-view">
          <div className="cal-day-summary">
            <div
              className={`cal-day-number ${selected === today ? "is-today" : ""}`}
            >
              {date.getDate()}
            </div>
            <div>
              <span className="cal-eyebrow">
                {selected === today
                  ? "БЛИЖАЙШИЕ 7 ДНЕЙ"
                  : "7 ДНЕЙ С ВЫБРАННОЙ ДАТЫ"}
              </span>
              <h2>{rangeLabel(selected)}</h2>
              <p>
                {count} {plural(count)} по крайнему сроку · все статусы · по
                датам
              </p>
            </div>
          </div>
          {count ? (
            <div className="cal-upcoming-agenda">
              {groups.map((g) => (
                <section
                  className="cal-agenda-day"
                  key={g.key}
                  data-agenda-date={g.key}
                >
                  <header className="cal-agenda-day-heading">
                    <span className="cal-eyebrow">
                      {g.key === today
                        ? "СЕГОДНЯ"
                        : parseDate(g.key)
                            .toLocaleDateString("ru-RU", { weekday: "long" })
                            .toUpperCase()}
                    </span>
                    <h3>
                      {parseDate(g.key).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "long",
                      })}
                    </h3>
                    <small>
                      {g.tasks.length} {plural(g.tasks.length)}
                    </small>
                    <button
                      className="cal-week-add"
                      onClick={() => onNew(g.key)}
                      aria-label={`Добавить задачу на ${longDate(g.key)}`}
                    >
                      <Plus className="icon" />
                      Задача
                    </button>
                  </header>
                  <div className="cal-day-task-grid">
                    {g.tasks.map((t) => card(t))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="cal-day-empty">
              <Cat mood="sleep" className="empty-cat" />
              <h3>В ближайшие 7 дней дедлайнов нет</h3>
              <p>Календарь пока делает вид, что всё спокойно.</p>
              <button className="secondary-btn" onClick={() => onNew(selected)}>
                <Plus className="icon" />
                Добавить задачу
              </button>
            </div>
          )}
        </section>
      )}
      <div className="cal-bottom-note">
        <Clock className="icon" />
        {undated
          ? `${undated} ${plural(undated)} без срока — к календарю не привязаны.`
          : "Задачи без срока сюда не попадают."}
      </div>
    </>
  );
}
