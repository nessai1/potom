import { describe, expect, it } from "vitest";
import { catRemarks } from "./cat-remarks";

describe("реплики кота-аналитика", () => {
  it("содержит 110 уникальных реплик и сохраняет десять исходных", () => {
    expect(catRemarks).toHaveLength(110);
    expect(new Set(catRemarks.map(({ text }) => text)).size).toBe(110);
    expect(catRemarks.slice(0, 10).map(({ text }) => text)).toEqual([
      "Лапки есть. ТЗ нет.",
      "Мяу. Бизнес опять насрал в требования.",
      "Созвон на пять минут? Пиздёж.",
      "Погладь кота. Таску трогать страшнее.",
      "Я не токсичная. Я читала этот бэклог.",
      "Мур. Теперь закрой эту херню.",
      "У меня девять жизней. У тебя один дедлайн.",
      "Кусь за «там просто кнопочку».",
      "Требования уточнили. Я охуела уточнённо.",
      "Котик хочет спать. Бизнес хочет всё.",
    ]);
  });

  it("каждой реплике даёт отдельную непустую версию без мата", () => {
    const profanity =
      /(?:пизд|[её]бан|за[её]б|охуе|ахуе|херн|насра|сран|жоп|бляд|блят|ху[йеяёю]|сука)/iu;
    expect(new Set(catRemarks.map(({ clean }) => clean)).size).toBe(110);
    for (const { text, clean } of catRemarks) {
      expect(text.trim()).toBe(text);
      expect(clean.trim()).toBe(clean);
      expect(clean.length).toBeGreaterThan(0);
      expect(clean).not.toMatch(profanity);
    }
  });

  it("большинство новых реплик резкие, а чистые версии передают их смысл отдельно", () => {
    const sharp = catRemarks
      .slice(60)
      .filter(({ text }) =>
        /(?:пизд|[её]бан|за[её]б|охуе|ахуе|херн|насра|жоп|бляд|ху[йеяёю]|сука)/iu.test(
          text,
        ),
      );
    expect(sharp.length).toBeGreaterThanOrEqual(30);
    expect(sharp.length).toBeLessThanOrEqual(40);
    for (const { text, clean } of sharp) expect(clean).not.toBe(text);
  });
});
