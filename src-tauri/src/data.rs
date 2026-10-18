use serde_json::{Value, json};
use std::collections::HashSet;

pub const MAX_ARCHIVE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_SAFE_ID: u64 = 9_007_199_254_740_991;

pub struct Archive {
    pub data: Value,
    pub migrated: bool,
}

fn error(path: &str, expected: &str) -> String {
    format!("Неверные данные: {path} — {expected}. Исходный файл не изменён.")
}

fn string<'a>(value: &'a Value, path: &str) -> Result<&'a str, String> {
    value
        .as_str()
        .ok_or_else(|| error(path, "ожидалась строка"))
}

fn array<'a>(value: &'a Value, path: &str) -> Result<&'a Vec<Value>, String> {
    value
        .as_array()
        .ok_or_else(|| error(path, "ожидался список"))
}

fn id(value: &Value, path: &str) -> Result<u64, String> {
    value
        .as_u64()
        .filter(|id| *id > 0 && *id <= MAX_SAFE_ID)
        .ok_or_else(|| error(path, "ожидался положительный целый идентификатор"))
}

pub fn is_date(value: &str) -> bool {
    if value.len() != 10
        || !value.is_ascii()
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
        || !value
            .as_bytes()
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
    {
        return false;
    }
    let Ok(year) = value[..4].parse::<u32>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = value[8..].parse::<u32>() else {
        return false;
    };
    if year == 0 {
        return false;
    }
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn date(value: &Value, path: &str, empty: bool) -> Result<(), String> {
    let text = string(value, path)?;
    if (empty && text.is_empty()) || is_date(text) {
        Ok(())
    } else {
        Err(error(path, "ожидалась существующая дата YYYY-MM-DD"))
    }
}

pub fn parse_archive(bytes: &[u8]) -> Result<Archive, String> {
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Файл больше 50 МБ.".into());
    }
    let mut data: Value = serde_json::from_slice(bytes)
        .map_err(|e| format!("Не удалось прочитать JSON: {e}. Исходный файл не изменён."))?;
    let object = data
        .as_object_mut()
        .ok_or_else(|| error("архив", "ожидался объект"))?;
    let mut migrated = match object.get("schema") {
        None => true,
        Some(value) if value.as_u64() == Some(1) => true,
        Some(value) if value.as_u64() == Some(2) => false,
        Some(value) if value.as_u64().is_some_and(|n| n > 2) => return Err("Эта резервная копия создана более новой версией приложения. Обновите приложение; данные не изменены.".into()),
        _ => return Err(error("schema", "неподдерживаемая версия")),
    };
    if migrated {
        object.insert("schema".into(), json!(2));
        object.entry("unlocked").or_insert_with(|| json!([]));
        object.entry("metrics").or_insert_with(|| json!({}));
        object
            .entry("settings")
            .or_insert_with(|| json!({"theme":"light","cleanLanguage":false}));
        if let Some(settings) = object.get_mut("settings").and_then(Value::as_object_mut) {
            settings.entry("theme").or_insert_with(|| json!("light"));
            settings
                .entry("cleanLanguage")
                .or_insert_with(|| json!(false));
        }
        if let Some(tasks) = object.get_mut("tasks").and_then(Value::as_array_mut) {
            for task in tasks {
                if let Some(task) = task.as_object_mut() {
                    task.entry("description").or_insert_with(|| json!(""));
                    task.entry("checklist").or_insert_with(|| json!([]));
                    task.entry("notes").or_insert_with(|| json!([]));
                    task.entry("due").or_insert_with(|| json!(""));
                    task.entry("priority").or_insert_with(|| json!("normal"));
                }
            }
        }
    }
    // The handed-off schema 2 prototype omitted this setting until the first toggle.
    if let Some(settings) = object.get_mut("settings").and_then(Value::as_object_mut)
        && !settings.contains_key("cleanLanguage")
    {
        settings.insert("cleanLanguage".into(), json!(false));
        migrated = true;
    }
    validate(&data)?;
    Ok(Archive { data, migrated })
}

pub fn validate(data: &Value) -> Result<(), String> {
    if data["schema"].as_u64() != Some(2) {
        return Err(error("schema", "ожидалась версия 2"));
    }
    let projects = array(&data["projects"], "projects")?;
    let mut project_ids = HashSet::new();
    for (index, project) in projects.iter().enumerate() {
        let path = format!("projects[{index}]");
        let id = string(&project["id"], &format!("{path}.id"))?;
        if id.is_empty() || !project_ids.insert(id) {
            return Err(error(&path, "пустой или повторяющийся id"));
        }
        if string(&project["name"], &format!("{path}.name"))?
            .trim()
            .is_empty()
        {
            return Err(error(&path, "пустое название проекта"));
        }
        let color = string(&project["color"], &format!("{path}.color"))?;
        if color.len() != 7
            || !color.starts_with('#')
            || !color[1..].bytes().all(|v| v.is_ascii_hexdigit())
        {
            return Err(error(&path, "цвет должен быть #RRGGBB"));
        }
    }
    let mut task_ids = HashSet::new();
    for (index, task) in array(&data["tasks"], "tasks")?.iter().enumerate() {
        let path = format!("tasks[{index}]");
        if !task_ids.insert(id(&task["id"], &format!("{path}.id"))?) {
            return Err(error(&path, "повторяющийся id"));
        }
        if string(&task["title"], &format!("{path}.title"))?
            .trim()
            .is_empty()
        {
            return Err(error(&path, "пустое название задачи"));
        }
        let project = string(&task["project"], &format!("{path}.project"))?;
        if !project_ids.contains(project) {
            return Err(error(&path, "проект задачи не найден"));
        }
        if !["created", "progress", "deferred", "done"]
            .contains(&string(&task["status"], &format!("{path}.status"))?)
        {
            return Err(error(&path, "неизвестный статус"));
        }
        if !["high", "normal", "low"]
            .contains(&string(&task["priority"], &format!("{path}.priority"))?)
        {
            return Err(error(&path, "неизвестный приоритет"));
        }
        string(&task["description"], &format!("{path}.description"))?;
        date(&task["due"], &format!("{path}.due"), true)?;
        date(&task["created"], &format!("{path}.created"), false)?;
        if let Some(completed) = task.get("completedAt") {
            date(completed, &format!("{path}.completedAt"), false)?;
        }
        for (item_index, item) in array(&task["checklist"], &format!("{path}.checklist"))?
            .iter()
            .enumerate()
        {
            let item_path = format!("{path}.checklist[{item_index}]");
            string(&item["text"], &format!("{item_path}.text"))?;
            if !item["done"].is_boolean()
                || item.get("wasUnchecked").is_some_and(|v| !v.is_boolean())
            {
                return Err(error(&item_path, "ожидался флаг true/false"));
            }
        }
        let mut note_ids = HashSet::new();
        for (note_index, note) in array(&task["notes"], &format!("{path}.notes"))?
            .iter()
            .enumerate()
        {
            let note_path = format!("{path}.notes[{note_index}]");
            if !note_ids.insert(id(&note["id"], &format!("{note_path}.id"))?) {
                return Err(error(&note_path, "повторяющийся id"));
            }
            string(&note["text"], &format!("{note_path}.text"))?;
            date(&note["date"], &format!("{note_path}.date"), false)?;
            if let Some(title) = note.get("title") {
                string(title, &format!("{note_path}.title"))?;
            }
        }
    }
    let mut unlocked = HashSet::new();
    for value in array(&data["unlocked"], "unlocked")? {
        if !unlocked.insert(string(value, "unlocked[]")?) {
            return Err(error("unlocked", "повторяющийся id"));
        }
    }
    let metrics = data["metrics"]
        .as_object()
        .ok_or_else(|| error("metrics", "ожидался объект"))?;
    for (key, value) in metrics {
        let valid_number = |n: &Value| n.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0);
        if !valid_number(value)
            && !value
                .as_object()
                .is_some_and(|m| m.values().all(valid_number))
        {
            return Err(error(
                &format!("metrics.{key}"),
                "ожидался неотрицательный счётчик",
            ));
        }
    }
    if !["light", "dark"].contains(&string(&data["settings"]["theme"], "settings.theme")?)
        || !data["settings"]["cleanLanguage"].is_boolean()
    {
        return Err(error("settings", "неверные настройки"));
    }
    Ok(())
}

#[cfg(test)]
pub fn fixture() -> Value {
    json!({"schema":2,"tasks":[{"id":1,"title":"Мой **текст**","project":"p","status":"created","due":"","priority":"normal","description":"  # Сохранить\n\n<script>мой текст</script>  ","checklist":[],"notes":[{"id":1,"text":"# Doc\n\n| X | Y |","date":"2024-02-29"}],"created":"2024-02-29"}],"projects":[{"id":"p","name":"Проект","color":"#eeaacc"}],"unlocked":[],"metrics":{},"settings":{"theme":"light","cleanLanguage":false}})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_real_and_not_unicode_or_overflow() {
        for valid in ["2024-02-29", "2000-02-29", "2026-12-31"] {
            assert!(is_date(valid));
        }
        for invalid in [
            "2023-02-29",
            "1900-02-29",
            "0000-01-01",
            "2026-04-31",
            "2026-1-01",
            "2026-13-01",
            "２０２６-01-01",
            "2026-01-00",
            "+026-01-01",
            "2026-+1-01",
        ] {
            assert!(!is_date(invalid), "{invalid}");
        }
    }

    #[test]
    fn migration_preserves_every_existing_user_text() {
        let mut original = fixture();
        original.as_object_mut().unwrap().remove("schema");
        original.as_object_mut().unwrap().remove("metrics");
        original.as_object_mut().unwrap().remove("settings");
        let parsed = parse_archive(&serde_json::to_vec(&original).unwrap()).unwrap();
        assert!(parsed.migrated);
        assert_eq!(parsed.data["tasks"], original["tasks"]);
        assert_eq!(parsed.data["projects"], original["projects"]);
        assert_eq!(parsed.data["schema"], 2);
    }

    #[test]
    fn original_schema_two_with_theme_only_gets_missing_language_default() {
        let mut original = fixture();
        original["settings"]
            .as_object_mut()
            .unwrap()
            .remove("cleanLanguage");
        let parsed = parse_archive(&serde_json::to_vec(&original).unwrap()).unwrap();
        assert!(parsed.migrated);
        assert_eq!(parsed.data["settings"]["cleanLanguage"], false);
        assert_eq!(parsed.data["tasks"], original["tasks"]);
    }

    #[test]
    fn rejects_future_malformed_duplicate_and_dangling_project() {
        let data = fixture();
        for (path, invalid) in [
            ("schema", json!(3)),
            ("tasks", json!({})),
            ("metrics", json!({"clicks":-1})),
        ] {
            let mut bad = data.clone();
            bad[path] = invalid;
            assert!(parse_archive(&serde_json::to_vec(&bad).unwrap()).is_err());
        }
        let mut bad = data.clone();
        bad["tasks"][0]["project"] = json!("missing");
        assert!(validate(&bad).is_err());
        let mut bad = data.clone();
        bad["tasks"]
            .as_array_mut()
            .unwrap()
            .push(data["tasks"][0].clone());
        assert!(validate(&bad).is_err());
        let mut bad = data.clone();
        bad["tasks"][0]["due"] = json!("2026-02-30");
        assert!(validate(&bad).is_err());
        assert!(parse_archive(b"broken json").is_err());
    }
}
