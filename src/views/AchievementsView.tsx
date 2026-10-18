import { useState } from "react";
import { Check } from "lucide-react";
import type { AppData } from "../types";
import { achievements, achievementProgress } from "../model/tasks";
import { Cat, Garden } from "../components/TaskVisuals";
export default function AchievementsView({
  data,
  clean,
}: {
  data: AppData;
  clean: (s: string) => string;
}) {
  const [category, setCategory] = useState("Все"),
    n = data.unlocked.length;
  return (
    <>
      <div className="page-top">
        <div>
          <h1>{clean("Орден аналитического пиздеца")}</h1>
          <p>Выдан за выживание в среде, где «ничего сложного» — это угроза.</p>
        </div>
      </div>
      <div className="achievement-banner with-plants">
        <div className="medal">
          <Cat className="achievement-cat" />
        </div>
        <div>
          <h2>Не выгорела. Прожарилась.</h2>
          <p>
            {n} из {achievements.length} наград за то, что этот цирк до сих пор
            работает.
          </p>
        </div>
        <div className="achievement-overall">
          <span>
            {n} / {achievements.length} в коллекции
          </span>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${(n / achievements.length) * 100}%` }}
            />
          </div>
        </div>
        <Garden className="achievement-greenery" />
      </div>
      <div className="achievement-category-tabs">
        {["Все", ...new Set(achievements.map((a) => a.category))].map((c) => (
          <button
            className={category === c ? "active" : ""}
            key={c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="achievement-grid">
        {achievements
          .filter((a) => category === "Все" || a.category === category)
          .map((a) => {
            const earned = data.unlocked.includes(a.id),
              progress = Math.min(achievementProgress(data, a.id), a.goal);
            return (
              <article
                key={a.id}
                className={`achievement-card ${earned ? "" : "locked"}`}
              >
                <span className="achievement-state">
                  {earned ? <Check className="icon" /> : "◌"}
                  {earned ? "В кармане" : "Ещё не вляпалась"}
                </span>
                <div className="achievement-icon">{a.icon}</div>
                <span className="achievement-category">{a.category}</span>
                <h3>{data.settings.cleanLanguage ? a.cleanTitle : a.title}</h3>
                <p>
                  {data.settings.cleanLanguage
                    ? a.cleanDescription
                    : a.description}
                </p>
                {earned ? (
                  <span className="earned-date">
                    {clean("Заслужила. Каким, блядь, трудом.")}
                  </span>
                ) : (
                  <>
                    <div className="progress-title">
                      <span>До награды</span>
                      <span>
                        {progress} / {a.goal}
                      </span>
                    </div>
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label={
                        data.settings.cleanLanguage ? a.cleanTitle : a.title
                      }
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={a.goal}
                    >
                      <div
                        className="progress-fill"
                        style={{ width: `${(progress / a.goal) * 100}%` }}
                      />
                    </div>
                  </>
                )}
              </article>
            );
          })}
      </div>
    </>
  );
}
