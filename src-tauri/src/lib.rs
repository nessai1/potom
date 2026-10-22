mod attachments;
mod data;
mod quick_tasks;
mod storage;

use serde_json::Value;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use storage::{StorageInfo, Store};
use tauri::{Emitter, Manager, State};

struct AppStore(Mutex<Store>);

#[derive(Default)]
struct QuitGuard(AtomicBool);

impl QuitGuard {
    fn should_flush(&self, code: Option<i32>, has_main_window: bool) -> bool {
        has_main_window && !self.0.load(Ordering::Acquire) && (code.is_none() || code == Some(0))
    }

    fn authorize(&self) {
        self.0.store(true, Ordering::Release);
    }
}

/// The frontend calls this only after flushing active Markdown editors and the save queue.
#[tauri::command]
fn finish_quit(app: tauri::AppHandle, guard: State<'_, QuitGuard>) {
    guard.authorize();
    app.exit(0);
}

// Tao 0.37's stock Cocoa Quit selector calls applicationWillTerminate directly,
// bypassing Tauri's cancellable ExitRequested event. Route ordinary macOS menu,
// Cmd+Q and Dock Quit requests through AppHandle::exit first. The native delegate
// remains Tao's delegate, preserving its launch, URL, reopen and restoration hooks.
#[cfg(target_os = "macos")]
mod macos_quit {
    use std::{
        ffi::{c_char, c_void},
        sync::OnceLock,
    };

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn object_getClass(object: *mut c_void) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn send_object(receiver: *mut c_void, selector: *mut c_void) -> *mut c_void;
        fn class_addMethod(
            class: *mut c_void,
            selector: *mut c_void,
            implementation: *const c_void,
            types: *const c_char,
        ) -> i8;
    }

    // NSApplicationTerminateReply is NSUInteger on supported 64-bit macOS targets.
    extern "C" fn should_terminate(_: *mut c_void, _: *mut c_void, _: *mut c_void) -> usize {
        if let Some(app) = APP.get() {
            app.exit(0);
            0 // NSTerminateCancel: wait for the frontend's successful save acknowledgement.
        } else {
            1 // NSTerminateNow: never trap shutdown before application setup.
        }
    }

    pub fn install(app: &tauri::AppHandle) -> Result<(), std::io::Error> {
        // SAFETY: setup executes on AppKit's main thread. These no-argument selectors
        // return Objective-C objects; class_addMethod receives the exact NSUInteger
        // (id, SEL, NSApplication*) ABI and type encoding required by AppKit.
        unsafe {
            let class = objc_getClass(c"NSApplication".as_ptr());
            let application = send_object(class, sel_registerName(c"sharedApplication".as_ptr()));
            let delegate = send_object(application, sel_registerName(c"delegate".as_ptr()));
            if class.is_null() || application.is_null() || delegate.is_null() {
                return Err(std::io::Error::other(
                    "Не удалось подключить сохранение при выходе из приложения.",
                ));
            }
            APP.set(app.clone())
                .map_err(|_| std::io::Error::other("Обработчик выхода уже подключён."))?;
            if class_addMethod(
                object_getClass(delegate),
                sel_registerName(c"applicationShouldTerminate:".as_ptr()),
                should_terminate as *const () as *const c_void,
                c"Q@:@".as_ptr(),
            ) == 0
            {
                return Err(std::io::Error::other(
                    "Не удалось подключить системный обработчик выхода.",
                ));
            }
        }
        Ok(())
    }
}

fn locked<'a>(state: &'a State<'_, AppStore>) -> Result<std::sync::MutexGuard<'a, Store>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Хранилище занято после ошибки. Перезапустите приложение.".into())
}

#[tauri::command]
fn load_data(state: State<'_, AppStore>) -> Result<Option<Value>, String> {
    locked(&state)?.load()
}
#[tauri::command]
fn save_data(data: Value, state: State<'_, AppStore>) -> Result<(), String> {
    locked(&state)?.save(&data)
}
#[tauri::command]
fn reset_data(window: tauri::WebviewWindow, state: State<'_, AppStore>) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Очистить данные можно только из главного окна.".into());
    }
    locked(&state)?.reset()
}
#[tauri::command]
fn get_storage_info(state: State<'_, AppStore>) -> Result<StorageInfo, String> {
    Ok(locked(&state)?.info())
}

#[tauri::command]
async fn export_backup(state: State<'_, AppStore>) -> Result<Option<String>, String> {
    let bytes = locked(&state)?.export()?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Экспорт резервной копии")
        .set_file_name("potom-backup.json")
        .add_filter("Резервная копия JSON", &["json"])
        .save_file()
        .await
    else {
        return Ok(None);
    };
    storage::export_file(file.path(), &bytes)?;
    Ok(Some(file.path().to_string_lossy().into_owned()))
}

#[tauri::command]
async fn import_backup(state: State<'_, AppStore>) -> Result<Option<Value>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Импорт резервной копии")
        .add_filter("Резервная копия JSON", &["json"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let bytes = storage::read_archive(file.path())?;
    Ok(Some(locked(&state)?.import(&bytes)?))
}

#[tauri::command]
async fn export_markdown(name: String, text: String) -> Result<Option<String>, String> {
    let safe_name: String = name
        .chars()
        .filter(|c| !c.is_control() && !"/\\:*?\"<>|".contains(*c))
        .take(100)
        .collect();
    let safe_name = safe_name.trim().trim_matches('.');
    let filename = if safe_name.is_empty() {
        "Документ.md".to_string()
    } else {
        format!("{}.md", safe_name.trim_end_matches(".md"))
    };
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Сохранить Markdown")
        .set_file_name(filename)
        .add_filter("Markdown", &["md"])
        .save_file()
        .await
    else {
        return Ok(None);
    };
    storage::export_file(file.path(), text.as_bytes())?;
    Ok(Some(file.path().to_string_lossy().into_owned()))
}

#[tauri::command]
async fn save_attachment(
    window: tauri::WebviewWindow,
    attachment: attachments::Attachment,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Сохранить вложение можно только из главного окна.".into());
    }
    let bytes = attachment
        .decoded_bytes()
        .map_err(|reason| format!("Не удалось сохранить вложение: {reason}."))?;
    // No AppStore mutex is held while choosing a destination or writing the file.
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Сохранить вложение")
        .set_file_name(&attachment.name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    storage::export_file(file.path(), &bytes)?;
    Ok(Some(file.path().to_string_lossy().into_owned()))
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Некорректная ссылка.".to_string())?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Разрешены только обычные HTTP и HTTPS ссылки.".into());
    }
    open::that(parsed.as_str()).map_err(|e| format!("Не удалось открыть ссылку: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuitGuard::default())
        .manage(quick_tasks::QuickTasksState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[quick_tasks::LABEL])
                .build(),
        )
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            app.manage(AppStore(Mutex::new(Store::new(directory))));
            #[cfg(target_os = "macos")]
            macos_quit::install(app.handle())?;
            quick_tasks::create(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            reset_data,
            export_backup,
            import_backup,
            get_storage_info,
            export_markdown,
            save_attachment,
            open_external,
            finish_quit,
            quick_tasks::set_quick_tasks_expanded,
            quick_tasks::show_quick_tasks,
            quick_tasks::quick_tasks_expanded,
            quick_tasks::open_quick_task
        ])
        .build(tauri::generate_context!())
        .expect("Не удалось запустить потом.")
        .run(|app, event| {
            // Main's close handler has already flushed editors and durable storage.
            // Its helper window must not keep a headless application running.
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = &event
                && label == "main"
                && let Some(widget) = app.get_webview_window(quick_tasks::LABEL)
            {
                let _ = widget.destroy();
            }
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event
                && let Some(window) = app.get_webview_window("main")
                && app.state::<QuitGuard>().should_flush(code, true)
            {
                api.prevent_exit();
                if let Err(error) = window.emit("potom:request-quit", ()) {
                    eprintln!("Не удалось запросить сохранение перед выходом: {error}");
                }
            }
        });
}

#[cfg(test)]
mod quit_tests {
    use super::QuitGuard;

    #[test]
    fn quit_waits_for_save_acknowledgement_without_trapping_closed_windows_or_errors() {
        let guard = QuitGuard::default();
        assert!(guard.should_flush(None, true));
        assert!(guard.should_flush(Some(0), true));
        assert!(!guard.should_flush(None, false));
        assert!(!guard.should_flush(Some(0), false));
        assert!(!guard.should_flush(Some(1), true));
        guard.authorize();
        assert!(!guard.should_flush(Some(0), true));
        assert!(!guard.should_flush(None, true));
    }
}
