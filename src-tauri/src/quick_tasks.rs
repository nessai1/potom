use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow};

pub const LABEL: &str = "quick-tasks";
const COLLAPSED: (f64, f64) = (76.0, 64.0);
const EXPANDED: (f64, f64) = (360.0, 440.0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug)]
struct Anchor {
    right: bool,
    bottom: bool,
}

impl Anchor {
    fn closest(bounds: Bounds, work: Bounds) -> Self {
        Self {
            right: f64::from(bounds.x) + f64::from(bounds.width) / 2.0
                >= f64::from(work.x) + f64::from(work.width) / 2.0,
            bottom: f64::from(bounds.y) + f64::from(bounds.height) / 2.0
                >= f64::from(work.y) + f64::from(work.height) / 2.0,
        }
    }
}

struct WidgetState {
    expanded: bool,
    anchor: Anchor,
}
pub struct QuickTasksState(Mutex<WidgetState>);

impl Default for QuickTasksState {
    fn default() -> Self {
        Self(Mutex::new(WidgetState {
            expanded: false,
            anchor: Anchor {
                right: true,
                bottom: true,
            },
        }))
    }
}

fn work_area(monitor: &tauri::Monitor) -> Bounds {
    let area = monitor.work_area();
    Bounds {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    }
}

fn size(expanded: bool, scale: f64, work: Bounds) -> (u32, u32) {
    let (width, height) = if expanded { EXPANDED } else { COLLAPSED };
    (
        ((width * scale).round() as u32).min(work.width).max(1),
        ((height * scale).round() as u32).min(work.height).max(1),
    )
}

/// Physical coordinates keep negative monitor origins and mixed DPI consistent.
fn resize(bounds: Bounds, work: Bounds, dimensions: (u32, u32), anchor: Anchor) -> Bounds {
    let (width, height) = dimensions;
    let x = i64::from(bounds.x)
        + if anchor.right {
            i64::from(bounds.width) - i64::from(width)
        } else {
            0
        };
    let y = i64::from(bounds.y)
        + if anchor.bottom {
            i64::from(bounds.height) - i64::from(height)
        } else {
            0
        };
    Bounds {
        x: x.clamp(
            i64::from(work.x),
            i64::from(work.x) + i64::from(work.width.saturating_sub(width)),
        ) as i32,
        y: y.clamp(
            i64::from(work.y),
            i64::from(work.y) + i64::from(work.height.saturating_sub(height)),
        ) as i32,
        width,
        height,
    }
}

pub fn create(app: &tauri::AppHandle) -> tauri::Result<()> {
    let main_monitor = app
        .get_webview_window("main")
        .map(|main| main.current_monitor())
        .transpose()?
        .flatten();
    let monitor = main_monitor.or(app.primary_monitor()?);
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?widget=1".into()))
            .title("потом. · В работе")
            .inner_size(COLLAPSED.0, COLLAPSED.1)
            .decorations(false)
            .transparent(true)
            .background_color(tauri::webview::Color(0, 0, 0, 0))
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .accept_first_mouse(true)
            .zoom_hotkeys_enabled(false)
            .disable_drag_drop_handler();
    #[cfg(target_os = "macos")]
    {
        builder = builder.visible_on_all_workspaces(true);
    }
    let placement = monitor.map(|monitor| {
        let work = work_area(&monitor);
        let scale = monitor.scale_factor();
        let (width, height) = size(false, scale, work);
        let margin = (16.0 * scale).round() as u32;
        let origin = Bounds {
            x: work
                .x
                .saturating_add(work.width.saturating_sub(width + margin) as i32),
            y: work
                .y
                .saturating_add(work.height.saturating_sub(height + margin) as i32),
            width,
            height,
        };
        (
            resize(
                origin,
                work,
                (width, height),
                Anchor {
                    right: true,
                    bottom: true,
                },
            ),
            scale,
        )
    });
    if let Some((bounds, scale)) = placement {
        builder = builder.position(f64::from(bounds.x) / scale, f64::from(bounds.y) / scale);
    }
    // A visible, initially unfocused window uses orderFront on macOS. show()
    // after hidden construction would makeKeyAndOrderFront and steal focus.
    let window = builder.build()?;
    if let Some((bounds, _)) = placement {
        window.set_position(PhysicalPosition::new(bounds.x, bounds.y))?;
        window.set_size(PhysicalSize::new(bounds.width, bounds.height))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_quick_tasks_expanded(
    window: WebviewWindow,
    expanded: bool,
    state: State<'_, QuickTasksState>,
) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("Эта команда доступна только плавающему списку задач.".into());
    }
    set_expanded(&window, expanded, &state)
}

fn set_expanded(
    window: &WebviewWindow,
    expanded: bool,
    state: &QuickTasksState,
) -> Result<(), String> {
    let mut state = state
        .0
        .lock()
        .map_err(|_| "Не удалось изменить размер списка задач.".to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "Не удалось определить рабочую область экрана.".to_string())?;
    let work = work_area(&monitor);
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let dimensions = window.outer_size().map_err(|e| e.to_string())?;
    let current = Bounds {
        x: position.x,
        y: position.y,
        width: dimensions.width,
        height: dimensions.height,
    };
    let anchor = if !state.expanded && expanded {
        Anchor::closest(current, work)
    } else {
        state.anchor
    };
    let next = resize(
        current,
        work,
        size(expanded, monitor.scale_factor(), work),
        anchor,
    );
    window
        .set_size(PhysicalSize::new(next.width, next.height))
        .map_err(|e| e.to_string())?;
    if let Err(error) = window.set_position(PhysicalPosition::new(next.x, next.y)) {
        let _ = window.set_size(dimensions);
        let _ = window.set_position(position);
        return Err(error.to_string());
    }
    state.expanded = expanded;
    state.anchor = anchor;
    // Keep resize/state/event order serialized, including main's show request
    // racing the helper's collapse button. The native event is the UI authority.
    window
        .emit_to(LABEL, "potom:quick-expanded", expanded)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_tasks_expanded(
    window: WebviewWindow,
    state: State<'_, QuickTasksState>,
) -> Result<bool, String> {
    if window.label() != LABEL {
        return Err("Эта команда доступна только плавающему списку задач.".into());
    }
    state
        .0
        .lock()
        .map(|state| state.expanded)
        .map_err(|_| "Не удалось получить состояние списка задач.".to_string())
}

// Async commands run off the UI thread; this also makes recreating a missing
// WebView2 helper safe on Windows, where synchronous creation can deadlock.
#[tauri::command]
pub async fn show_quick_tasks(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, QuickTasksState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Эта команда доступна только главному окну.".into());
    }
    let widget = if let Some(widget) = app.get_webview_window(LABEL) {
        widget
    } else {
        {
            let mut current = state
                .0
                .lock()
                .map_err(|_| "Не удалось открыть список задач.".to_string())?;
            current.expanded = false;
            current.anchor = Anchor {
                right: true,
                bottom: true,
            };
        }
        create(&app).map_err(|e| e.to_string())?;
        app.get_webview_window(LABEL)
            .ok_or_else(|| "Не удалось открыть список задач.".to_string())?
    };
    set_expanded(&widget, true, &state)?;
    widget.show().map_err(|e| e.to_string())?;
    widget.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_quick_task(app: tauri::AppHandle, id: u64) -> Result<(), String> {
    if id == 0 || id > 9_007_199_254_740_991 {
        return Err("Неверный идентификатор задачи.".into());
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Главное окно уже закрыто.".to_string())?;
    main.show().map_err(|e| e.to_string())?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    app.emit_to("main", "potom:open-task", id)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn right_bottom_anchor_roundtrips_without_moving_the_button() {
        let work = Bounds {
            x: 0,
            y: 30,
            width: 1440,
            height: 850,
        };
        let collapsed = Bounds {
            x: 1348,
            y: 800,
            width: 76,
            height: 64,
        };
        let anchor = Anchor::closest(collapsed, work);
        let expanded = resize(collapsed, work, size(true, 1.0, work), anchor);
        assert_eq!(
            expanded,
            Bounds {
                x: 1064,
                y: 424,
                width: 360,
                height: 440
            }
        );
        assert_eq!(
            resize(expanded, work, size(false, 1.0, work), anchor),
            collapsed
        );
    }

    #[test]
    fn top_left_anchor_and_dragged_expanded_window_keep_the_same_corner() {
        let work = Bounds {
            x: 0,
            y: 0,
            width: 1440,
            height: 900,
        };
        let collapsed = Bounds {
            x: 16,
            y: 16,
            width: 76,
            height: 64,
        };
        let anchor = Anchor::closest(collapsed, work);
        let expanded = resize(collapsed, work, size(true, 1.0, work), anchor);
        assert_eq!((expanded.x, expanded.y), (16, 16));
        let dragged = Bounds {
            x: 300,
            y: 100,
            ..expanded
        };
        let collapsed_after_drag = resize(dragged, work, size(false, 1.0, work), anchor);
        assert_eq!((collapsed_after_drag.x, collapsed_after_drag.y), (300, 100));
    }

    #[test]
    fn mixed_dpi_negative_monitors_and_tiny_workareas_are_clamped() {
        let work = Bounds {
            x: -2560,
            y: -100,
            width: 2560,
            height: 1400,
        };
        let collapsed = Bounds {
            x: -2700,
            y: 1300,
            width: 152,
            height: 128,
        };
        let expanded = resize(
            collapsed,
            work,
            size(true, 2.0, work),
            Anchor {
                right: false,
                bottom: true,
            },
        );
        assert_eq!(
            expanded,
            Bounds {
                x: -2560,
                y: 420,
                width: 720,
                height: 880
            }
        );
        let tiny = Bounds {
            x: 400,
            y: 500,
            width: 300,
            height: 250,
        };
        let fitted = resize(
            expanded,
            tiny,
            size(true, 2.0, tiny),
            Anchor {
                right: true,
                bottom: true,
            },
        );
        assert_eq!(fitted, tiny);
    }
}
