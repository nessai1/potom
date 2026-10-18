use crate::data::{MAX_ARCHIVE_BYTES, parse_archive, validate};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const BACKUP_LIMIT: usize = 20;
const BACKUP_INTERVAL: Duration = Duration::from_secs(15 * 60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    path: String,
    backup_directory: String,
}

pub struct Store {
    directory: PathBuf,
    last_backup: Option<SystemTime>,
}

fn io_error(e: impl std::fmt::Display) -> String {
    format!("Ошибка хранилища: {e}. Изменения не подтверждены.")
}

pub fn read_archive(path: &Path) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(io_error)?;
    if file.metadata().map_err(io_error)?.len() > MAX_ARCHIVE_BYTES {
        return Err("Файл больше 50 МБ.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Файл больше 50 МБ.".into());
    }
    Ok(bytes)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io_error)?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(path);
        return Err(io_error(error));
    }
    Ok(())
}

/// Native export writes to a sibling temp file first; cancel/error cannot truncate the existing file.
pub fn export_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "У файла нет родительской папки".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    temporary.write_all(bytes).map_err(io_error)?;
    temporary.as_file().sync_all().map_err(io_error)?;
    temporary.persist(path).map_err(io_error)?;
    sync_directory(parent)?;
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(io_error)
}
#[cfg(not(unix))]
fn sync_directory(_: &Path) -> Result<(), String> {
    Ok(())
}

fn timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

impl Store {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            last_backup: None,
        }
    }
    fn path(&self) -> PathBuf {
        self.directory.join("potom.sqlite3")
    }
    fn backups(&self) -> PathBuf {
        self.directory.join("backups")
    }
    pub fn info(&self) -> StorageInfo {
        StorageInfo {
            path: self.path().to_string_lossy().into_owned(),
            backup_directory: self.backups().to_string_lossy().into_owned(),
        }
    }

    fn connection_at(path: &Path) -> Result<Connection, String> {
        let connection = Connection::open(path).map_err(io_error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(io_error)?;
        connection
            .pragma_update(None, "journal_mode", "DELETE")
            .map_err(io_error)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(io_error)?;
        let db_version: u32 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(io_error)?;
        if db_version > 2 {
            return Err("База создана более новой версией приложения. Обновите приложение; данные не изменены.".into());
        }
        connection.execute_batch("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id = 1), document TEXT NOT NULL CHECK(json_valid(document))); ").map_err(io_error)?;
        Ok(connection)
    }

    fn connection(&self) -> Result<Connection, String> {
        fs::create_dir_all(&self.directory).map_err(io_error)?;
        Self::connection_at(&self.path())
    }

    fn raw(&self) -> Result<Option<String>, String> {
        let connection = self.connection()?;
        connection
            .query_row("SELECT document FROM app_state WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(io_error)
    }

    fn commit_at(path: &Path, text: &str) -> Result<(), String> {
        let mut connection = Self::connection_at(path)?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io_error)?;
        transaction.execute("INSERT INTO app_state (id, document) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET document = excluded.document", params![text]).map_err(io_error)?;
        transaction
            .pragma_update(None, "user_version", 2)
            .map_err(io_error)?;
        transaction.commit().map_err(io_error)
    }

    pub fn load(&mut self) -> Result<Option<Value>, String> {
        let Some(raw) = self.raw()? else {
            return Ok(None);
        };
        let archive = parse_archive(raw.as_bytes())?;
        if archive.migrated {
            self.backup_bytes("migration", raw.as_bytes())?;
            Self::commit_at(
                &self.path(),
                &serde_json::to_string(&archive.data).map_err(io_error)?,
            )?;
        }
        Ok(Some(archive.data))
    }

    fn backup_bytes(&mut self, reason: &str, bytes: &[u8]) -> Result<PathBuf, String> {
        fs::create_dir_all(self.backups()).map_err(io_error)?;
        let path = self
            .backups()
            .join(format!("potom-{reason}-{}.json", timestamp()));
        write_new(&path, bytes)?;
        sync_directory(&self.backups())?;
        self.last_backup = Some(SystemTime::now());
        self.prune_backups()?;
        Ok(path)
    }

    fn prune_backups(&self) -> Result<(), String> {
        let mut entries = fs::read_dir(self.backups())
            .map_err(io_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io_error)?;
        entries.retain(|entry| {
            entry.file_name().to_string_lossy().starts_with("potom-")
                && entry.path().extension().is_some_and(|e| e == "json")
        });
        entries.sort_by_key(|entry| entry.file_name());
        // Timestamp is always the final component; sort by modification time rather than reason.
        entries.sort_by_key(|entry| {
            entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(UNIX_EPOCH)
        });
        let remove_count = entries.len().saturating_sub(BACKUP_LIMIT);
        for entry in entries.into_iter().take(remove_count) {
            fs::remove_file(entry.path()).map_err(io_error)?;
        }
        Ok(())
    }

    pub fn save(&mut self, data: &Value) -> Result<(), String> {
        validate(data)?;
        let text = serde_json::to_string(data).map_err(io_error)?;
        if text.len() as u64 > MAX_ARCHIVE_BYTES {
            return Err("Данные больше 50 МБ. Уменьшите размер документов.".into());
        }
        if let Some(previous) = self.raw()? {
            // Never silently overwrite a malformed or future database, even with valid demo data.
            parse_archive(previous.as_bytes())?;
            if previous == text {
                return Ok(());
            }
            if self
                .last_backup
                .is_none_or(|time| time.elapsed().unwrap_or_default() >= BACKUP_INTERVAL)
            {
                self.backup_bytes("autosave", previous.as_bytes())?;
            }
        } else {
            self.backup_bytes("autosave", text.as_bytes())?;
        }
        Self::commit_at(&self.path(), &text)?;
        Ok(())
    }

    pub fn export(&mut self) -> Result<Vec<u8>, String> {
        let value = self
            .load()?
            .ok_or_else(|| "Пока нет сохранённых данных.".to_string())?;
        serde_json::to_vec_pretty(&value).map_err(io_error)
    }

    pub fn import(&mut self, bytes: &[u8]) -> Result<Value, String> {
        let archive = parse_archive(bytes)?;
        self.replace_validated(
            archive.data,
            "before-import",
            archive.migrated.then_some(bytes),
        )
    }

    /// Persist an explicitly empty workspace, including on the very first launch.
    /// A readable database stays in place: SQLite rolls back any failed reset.
    pub fn reset(&mut self) -> Result<Value, String> {
        let empty = serde_json::json!({
            "schema": 2,
            "tasks": [],
            "projects": [],
            "unlocked": [],
            "metrics": {},
            "settings": { "theme": "light", "cleanLanguage": false }
        });
        match self.raw() {
            Ok(previous) => {
                if let Some(previous) = previous {
                    self.backup_bytes("before-reset", previous.as_bytes())?;
                }
                Self::commit_at(
                    &self.path(),
                    &serde_json::to_string(&empty).map_err(io_error)?,
                )?;
                self.last_backup = None;
                Ok(empty)
            }
            // Explicit reset can repair a corrupted or unreadable-version database,
            // preserving its original SQLite files before atomic replacement.
            Err(_) if self.path().is_file() => self.replace_validated(empty, "before-reset", None),
            Err(error) => Err(error),
        }
    }

    fn backup_database(&self, reason: &str) -> Result<(), String> {
        fs::create_dir_all(self.backups()).map_err(io_error)?;
        let stamp = timestamp();
        // Keep available recovery journals alongside a damaged database as well.
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let source = self.directory.join(format!("potom.sqlite3{suffix}"));
            if !suffix.is_empty() && !source.try_exists().map_err(io_error)? {
                continue;
            }
            let target = self
                .backups()
                .join(format!("corrupted-{reason}-{stamp}.sqlite3{suffix}"));
            fs::copy(source, &target).map_err(io_error)?;
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(target)
                .map_err(io_error)?
                .sync_all()
                .map_err(io_error)?;
        }
        sync_directory(&self.backups())
    }

    fn replace_validated(
        &mut self,
        data: Value,
        backup_reason: &str,
        before_migration: Option<&[u8]>,
    ) -> Result<Value, String> {
        validate(&data)?;
        fs::create_dir_all(&self.directory).map_err(io_error)?;
        let text = serde_json::to_string(&data).map_err(io_error)?;
        // Candidate database is fully committed before touching the original, including corrupted originals.
        let candidate = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(io_error)?
            .into_temp_path();
        Self::commit_at(&candidate, &text)?;
        let backup_result = (|| -> Result<(), String> {
            match self.raw() {
                Ok(Some(previous)) => {
                    self.backup_bytes(backup_reason, previous.as_bytes())?;
                }
                Ok(None) => {}
                Err(_) if self.path().exists() => {
                    self.backup_database(backup_reason)?;
                }
                Err(error) => return Err(error),
            }
            if let Some(bytes) = before_migration {
                self.backup_bytes("import-before-migration", bytes)?;
            }
            Ok(())
        })();
        backup_result?;
        candidate.persist(self.path()).map_err(io_error)?;
        sync_directory(&self.directory)?;
        self.last_backup = None;
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::fixture;
    use serde_json::json;

    #[test]
    fn save_survives_restart_and_exports_saved_state() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        assert_eq!(store.load().unwrap(), None);
        let data = fixture();
        store.save(&data).unwrap();
        drop(store);
        let mut reopened = Store::new(directory.path().into());
        assert_eq!(reopened.load().unwrap(), Some(data.clone()));
        assert_eq!(
            serde_json::from_slice::<Value>(&reopened.export().unwrap()).unwrap(),
            data
        );
        assert!(fs::read_dir(reopened.backups()).unwrap().count() > 0);
    }

    #[test]
    fn invalid_import_or_save_does_not_replace_current_data() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        let data = fixture();
        store.save(&data).unwrap();
        assert!(store.import(b"{broken").is_err());
        let mut invalid = data.clone();
        invalid["schema"] = json!(99);
        assert!(
            store
                .import(&serde_json::to_vec(&invalid).unwrap())
                .is_err()
        );
        assert!(store.save(&invalid).is_err());
        assert_eq!(store.load().unwrap(), Some(data));
    }

    #[test]
    fn import_backs_up_previous_and_migration_preserves_markdown() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        let previous = fixture();
        store.save(&previous).unwrap();
        let mut incoming = previous.clone();
        incoming["schema"] = json!(1);
        incoming["tasks"][0]["title"] = json!("Новое название");
        let migrated = store
            .import(&serde_json::to_vec(&incoming).unwrap())
            .unwrap();
        assert_eq!(
            migrated["tasks"][0]["description"],
            incoming["tasks"][0]["description"]
        );
        assert_eq!(migrated["schema"], 2);
        let backups: Vec<_> = fs::read_dir(store.backups())
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert!(backups.iter().any(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .contains("before-import")
                && serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap() == previous
        }));
    }

    #[test]
    fn corrupted_database_is_never_seed_overwritten_but_valid_import_recovers() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        fs::write(store.path(), b"this database was damaged").unwrap();
        assert!(store.load().is_err());
        assert!(store.save(&fixture()).is_err());
        assert_eq!(
            fs::read(store.path()).unwrap(),
            b"this database was damaged"
        );
        let data = fixture();
        store.import(&serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(store.load().unwrap(), Some(data));
        assert!(fs::read_dir(store.backups()).unwrap().any(|e| {
            e.unwrap()
                .path()
                .extension()
                .is_some_and(|e| e == "sqlite3")
        }));
    }

    #[test]
    fn transaction_failure_rolls_back_and_keeps_previous_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        let data = fixture();
        store.save(&data).unwrap();
        let connection = store.connection().unwrap();
        connection.execute_batch("CREATE TRIGGER fail_write BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT, 'simulated disk error'); END;").unwrap();
        let mut updated = data.clone();
        updated["tasks"][0]["title"] = json!("Не сохранится");
        assert!(store.save(&updated).is_err());
        assert_eq!(store.load().unwrap(), Some(data));
    }

    #[test]
    fn periodic_backups_keep_bounded_recoverable_history() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        let mut data = fixture();
        for index in 0..25 {
            data["tasks"][0]["title"] = json!(format!("Версия {index}"));
            store.last_backup = None;
            store.save(&data).unwrap();
        }
        let files: Vec<_> = fs::read_dir(store.backups()).unwrap().collect();
        assert_eq!(files.len(), BACKUP_LIMIT);
        for file in files {
            parse_archive(&fs::read(file.unwrap().path()).unwrap()).unwrap();
        }
    }

    #[test]
    fn reset_persists_an_empty_workspace_and_preserves_a_restorable_original() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        let mut original = fixture();
        original["unlocked"] = json!(["first", "night"]);
        original["metrics"] = json!({"created": 10, "descriptionEdits": {"1": 4}});
        original["settings"] = json!({"theme": "dark", "cleanLanguage": true});
        store.save(&original).unwrap();
        let empty = store.reset().unwrap();
        assert_eq!(
            empty,
            json!({
                "schema": 2, "tasks": [], "projects": [], "unlocked": [], "metrics": {},
                "settings": {"theme": "light", "cleanLanguage": false}
            })
        );
        validate(&empty).unwrap();
        let backup = fs::read_dir(store.backups())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("before-reset")
            })
            .unwrap();
        let previous_bytes = fs::read(backup).unwrap();
        assert_eq!(parse_archive(&previous_bytes).unwrap().data, original);
        drop(store);
        let mut restarted = Store::new(directory.path().into());
        assert_eq!(restarted.load().unwrap(), Some(empty));
        assert_eq!(restarted.import(&previous_bytes).unwrap(), original);
    }

    #[test]
    fn reset_before_first_save_is_persistent_data_instead_of_a_seed_request() {
        let directory = tempfile::tempdir().unwrap();
        let empty = Store::new(directory.path().into()).reset().unwrap();
        let mut restarted = Store::new(directory.path().into());
        assert_eq!(restarted.load().unwrap(), Some(empty));
    }

    #[test]
    fn reset_repairs_a_corrupted_database_after_preserving_its_original_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        let damaged = b"a damaged database with irreplaceable original bytes";
        fs::write(store.path(), damaged).unwrap();
        let empty = store.reset().unwrap();
        let backup = fs::read_dir(store.backups())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("before-reset")
            })
            .unwrap();
        assert_eq!(fs::read(backup).unwrap(), damaged);
        drop(store);
        assert_eq!(
            Store::new(directory.path().into()).load().unwrap(),
            Some(empty)
        );
    }

    #[test]
    fn failed_reset_backup_preserves_valid_or_damaged_database_and_allows_retry() {
        for corrupt in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let mut store = Store::new(directory.path().into());
            if corrupt {
                fs::write(store.path(), b"damaged database").unwrap();
            } else {
                store.save(&fixture()).unwrap();
                fs::remove_dir_all(store.backups()).unwrap();
            }
            let before = fs::read(store.path()).unwrap();
            fs::write(store.backups(), b"backup directory is blocked").unwrap();
            assert!(store.reset().is_err());
            assert_eq!(fs::read(store.path()).unwrap(), before);
            if !corrupt {
                assert_eq!(store.load().unwrap(), Some(fixture()));
            }
            fs::remove_file(store.backups()).unwrap();
            let empty = store.reset().unwrap();
            assert_eq!(store.load().unwrap(), Some(empty));
        }
    }

    #[test]
    fn failed_reset_transaction_rolls_back_without_frontend_or_storage_data_loss() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::new(directory.path().into());
        let original = fixture();
        store.save(&original).unwrap();
        let connection = store.connection().unwrap();
        connection.execute_batch("CREATE TRIGGER fail_reset BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;").unwrap();
        assert!(store.reset().is_err());
        assert_eq!(store.load().unwrap(), Some(original));
        connection.execute_batch("DROP TRIGGER fail_reset").unwrap();
        let empty = store.reset().unwrap();
        drop(connection);
        drop(store);
        assert_eq!(
            Store::new(directory.path().into()).load().unwrap(),
            Some(empty)
        );
    }
}
