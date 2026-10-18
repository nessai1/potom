/** Date-only arithmetic uses UTC calendar dates: daylight saving never changes a day. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function todayKey(): string {
  return dateKey(new Date());
}
export function parseDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
const ordinal = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
export function addDays(key: string, days: number): string {
  const d = new Date((ordinal(key) + days) * 86400000);
  return d.toISOString().slice(0, 10);
}
export function dayDiff(key: string, base = todayKey()): number {
  return ordinal(key) - ordinal(base);
}
export function weekDates(key: string): string[] {
  const start = addDays(key, -((parseDate(key).getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
export function monthDates(key: string): string[] {
  const date = parseDate(key),
    first = dateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  const start = weekDates(first)[0];
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const count =
    Math.ceil((days + ((parseDate(first).getDay() + 6) % 7)) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
export function shiftMonth(key: string, amount: number): string {
  const date = parseDate(key),
    month = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  return dateKey(
    new Date(
      month.getFullYear(),
      month.getMonth(),
      Math.min(
        date.getDate(),
        new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
      ),
      12,
    ),
  );
}
export function shortDate(key: string): string {
  return key
    ? parseDate(key)
        .toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
        .replace(".", "")
    : "Срока нет";
}
export function longDate(key: string): string {
  return parseDate(key)
    .toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .replace(" г.", "");
}
export function rangeLabel(start: string, end = addDays(start, 6)): string {
  const year =
    start.slice(0, 4) === end.slice(0, 4)
      ? end.slice(0, 4)
      : `${start.slice(0, 4)} / ${end.slice(0, 4)}`;
  return `${shortDate(start)} — ${shortDate(end)} · ${year}`;
}
export function plural(
  n: number,
  forms = ["задача", "задачи", "задач"],
): string {
  const a = Math.abs(n);
  return forms[
    a % 100 >= 11 && a % 100 <= 14
      ? 2
      : a % 10 === 1
        ? 0
        : a % 10 >= 2 && a % 10 <= 4
          ? 1
          : 2
  ];
}
