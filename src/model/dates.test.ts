import { describe, expect, it } from "vitest";
import { addDays, dayDiff, monthDates, shiftMonth, weekDates } from "./dates";
describe("календарные даты без смещения часовых поясов", () => {
  it("переходит через месяц и год", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("учитывает високосный февраль", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(monthDates("2028-02-10")).toContain("2028-02-29");
    expect(monthDates("2027-02-10")).not.toContain("2027-02-29");
  });
  it("разница по календарю независима от DST", () => {
    expect(dayDiff("2026-03-30", "2026-03-28")).toBe(2);
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(dayDiff("2026-10-26", "2026-10-24")).toBe(2);
  });
  it("неделя начинается с понедельника и пересекает год", () => {
    expect(weekDates("2027-01-01")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
  it("переход месяца сохраняет число или ограничивает последним днём", () => {
    expect(shiftMonth("2028-01-31", 1)).toBe("2028-02-29");
    expect(shiftMonth("2026-12-31", 1)).toBe("2027-01-31");
    expect(shiftMonth("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("месячная сетка начинается с понедельника и содержит целые недели", () => {
    const grid = monthDates("2026-11-13");
    expect(grid[0]).toBe("2026-10-26");
    expect(grid.at(-1)).toBe("2026-12-06");
    expect(grid.length % 7).toBe(0);
  });
});
