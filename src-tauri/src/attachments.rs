use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ENCODED_BYTES: usize = ((MAX_FILE_BYTES as usize).div_ceil(3)) * 4;

#[derive(Debug, Deserialize, Serialize)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub data: String,
    pub added: String,
}

// Archive validation borrows base64 strings from serde_json::Value rather than
// cloning a potentially 14 MB string for every attachment in a backup.
#[derive(Deserialize)]
struct AttachmentRef<'a> {
    id: &'a str,
    name: &'a str,
    size: u64,
    mime: &'a str,
    data: &'a str,
    added: &'a str,
}

impl Attachment {
    pub fn decoded_bytes(&self) -> Result<Vec<u8>, String> {
        AttachmentRef {
            id: &self.id,
            name: &self.name,
            size: self.size,
            mime: &self.mime,
            data: &self.data,
            added: &self.added,
        }
        .decoded_bytes()
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn valid_name(name: &str) -> bool {
    if name.trim().is_empty()
        || name.encode_utf16().count() > 180
        || [".", ".."].contains(&name)
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
    {
        return false;
    }
    let stem = name.split('.').next().unwrap_or_default();
    let stem = stem.to_ascii_uppercase();
    !["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        && !(stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

impl AttachmentRef<'_> {
    fn decoded_bytes(&self) -> Result<Vec<u8>, String> {
        if !valid_id(self.id) {
            return Err("идентификатор вложения должен быть UUID".into());
        }
        if !valid_name(self.name) {
            return Err("небезопасное или слишком длинное имя файла".into());
        }
        if self.size > MAX_FILE_BYTES {
            return Err("размер файла превышает 10 МБ".into());
        }
        if self.mime.trim().is_empty()
            || self.mime.len() > 255
            || !self.mime.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
        {
            return Err("тип файла должен содержать до 255 печатных ASCII-символов".into());
        }
        if !crate::data::is_date(self.added) {
            return Err("неверная дата добавления файла".into());
        }
        if self.data.len() > MAX_ENCODED_BYTES {
            return Err("размер закодированного файла превышает 10 МБ".into());
        }
        let bytes = STANDARD
            .decode(self.data)
            .map_err(|_| "содержимое файла не является каноническим Base64".to_string())?;
        if bytes.len() as u64 != self.size {
            return Err("размер файла не совпадает с его содержимым".into());
        }
        if STANDARD.encode(&bytes) != self.data {
            return Err("содержимое файла не является каноническим Base64".into());
        }
        Ok(bytes)
    }
}

pub fn validate_value(value: &Value) -> Result<&str, String> {
    let attachment = AttachmentRef::deserialize(value)
        .map_err(|_| "ожидались поля вложения id, name, size, mime, data, added".to_string())?;
    attachment.decoded_bytes()?;
    Ok(attachment.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(bytes: &[u8]) -> Attachment {
        Attachment {
            id: "123e4567-e89b-42d3-a456-426614174000".into(),
            name: "Расчёт 🐈 и заметки.bin".into(),
            size: bytes.len() as u64,
            mime: "application/octet-stream".into(),
            data: STANDARD.encode(bytes),
            added: "2024-02-29".into(),
        }
    }

    #[test]
    fn binary_nuls_and_unicode_filename_survive_json_and_atomic_export() {
        let bytes = [0, 255, 128, 0, 13, 10, 65, 0, 42];
        let attachment = fixture(&bytes);
        let serialized = serde_json::to_vec(&attachment).unwrap();
        let restored: Attachment = serde_json::from_slice(&serialized).unwrap();
        assert_eq!(restored.name, attachment.name);
        let decoded = restored.decoded_bytes().unwrap();
        assert_eq!(decoded, bytes);
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join(&restored.name);
        crate::storage::export_file(&destination, &decoded).unwrap();
        assert_eq!(std::fs::read(destination).unwrap(), bytes);
        assert_eq!(
            validate_value(&serde_json::to_value(restored).unwrap()).unwrap(),
            attachment.id
        );
    }

    #[test]
    fn sqlite_restart_backups_and_import_export_retain_attachment_bytes_and_comment_draft() {
        let bytes = [0, 255, 0, 128, 10, 42];
        let attachment = fixture(&bytes);
        let mut data = crate::data::fixture();
        data["tasks"][0]["attachments"] = serde_json::json!([attachment]);
        data["tasks"][0]["commentDraft"] = serde_json::json!("  Черновик\n\nбез потерь  ");
        let directory = tempfile::tempdir().unwrap();
        let mut store = crate::storage::Store::new(directory.path().into());
        store.save(&data).unwrap();
        drop(store);
        let mut restarted = crate::storage::Store::new(directory.path().into());
        assert_eq!(restarted.load().unwrap(), Some(data.clone()));
        let backup = std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let backup_data = crate::data::parse_archive(&std::fs::read(backup).unwrap())
            .unwrap()
            .data;
        assert_eq!(backup_data, data);
        let exported = restarted.export().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let mut imported = crate::storage::Store::new(destination.path().into());
        assert_eq!(imported.import(&exported).unwrap(), data);
        let loaded = imported.load().unwrap().unwrap();
        let restored: Attachment =
            serde_json::from_value(loaded["tasks"][0]["attachments"][0].clone()).unwrap();
        assert_eq!(restored.decoded_bytes().unwrap(), bytes);
        assert_eq!(
            loaded["tasks"][0]["commentDraft"],
            data["tasks"][0]["commentDraft"]
        );
        assert_eq!(loaded["tasks"][0]["notes"], data["tasks"][0]["notes"]);
    }

    #[test]
    fn empty_files_and_exact_ten_megabytes_are_allowed() {
        assert!(fixture(&[]).decoded_bytes().unwrap().is_empty());
        let bytes = vec![0x9f; MAX_FILE_BYTES as usize];
        assert_eq!(fixture(&bytes).decoded_bytes().unwrap(), bytes);
    }

    #[test]
    fn rejects_noncanonical_base64_wrong_size_and_oversized_files() {
        for invalid in [
            "AA",
            "AB==",
            "AA===",
            "AA==\n",
            "_w==",
            "%%%%",
            "data:;base64,AA==",
        ] {
            let mut attachment = fixture(&[0]);
            attachment.data = invalid.into();
            assert!(attachment.decoded_bytes().is_err(), "{invalid}");
        }
        let mut attachment = fixture(&[0, 255]);
        attachment.size = 1;
        assert!(attachment.decoded_bytes().is_err());
        attachment.size = MAX_FILE_BYTES + 1;
        assert!(attachment.decoded_bytes().is_err());
        let mut oversized = fixture(&[]);
        oversized.data = "A".repeat(MAX_ENCODED_BYTES + 4);
        assert!(oversized.decoded_bytes().is_err());
    }

    #[test]
    fn rejects_path_traversal_controls_and_windows_device_filenames() {
        for name in [
            "",
            " ",
            ".",
            "..",
            "../x",
            "dir/file",
            "dir\\file",
            "C:evil.txt",
            "x\0.bin",
            "line\n.txt",
            "bad\u{0085}.txt",
            "x?y",
            "name.",
            "name ",
            "con",
            "AUX.txt",
            "nul.bin",
            "COM1.log",
            "lpt9",
        ] {
            let mut attachment = fixture(&[1]);
            attachment.name = name.into();
            assert!(attachment.decoded_bytes().is_err(), "{name:?}");
        }
        let mut attachment = fixture(&[1]);
        attachment.name = "🐈".repeat(91);
        assert!(attachment.decoded_bytes().is_err());
        attachment.name = "🐈".repeat(90);
        assert!(attachment.decoded_bytes().is_ok());
    }

    #[test]
    fn rejects_invalid_identifiers_mime_and_dates() {
        let mut attachment = fixture(&[1]);
        attachment.id.clear();
        assert!(attachment.decoded_bytes().is_err());
        attachment.id = "not-a-uuid".into();
        assert!(attachment.decoded_bytes().is_err());
        for mime in ["", " ", "application/pdf\r\nX: value", "тип/файла"] {
            let mut attachment = fixture(&[1]);
            attachment.mime = mime.into();
            assert!(attachment.decoded_bytes().is_err());
        }
        let mut attachment = fixture(&[1]);
        attachment.mime = "x".repeat(256);
        assert!(attachment.decoded_bytes().is_err());
        attachment.mime = "image/svg+xml; charset=utf-8".into();
        assert!(attachment.decoded_bytes().is_ok());
        attachment.added = "2025-02-29".into();
        assert!(attachment.decoded_bytes().is_err());
    }
}
