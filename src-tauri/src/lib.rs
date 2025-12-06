mod license;
use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
use tauri::{Emitter, Manager};

#[tauri::command]
fn get_startup_args() -> Vec<String> {
    std::env::args().collect()
}

#[tauri::command]
fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
// ... (existing setup code) ...
        .invoke_handler(tauri::generate_handler![
            license::verify_license,
            license::get_machine_id,
            get_startup_args
        ])
        .setup(|app| {
            let handle = app.handle();
            
            let app_menu = Submenu::with_items(
                handle,
                "ProTakeoff",
                true,
                &[
                    &PredefinedMenuItem::quit(handle, Some("Quit ProTakeoff"))?,
                ],
            )?;

            let file_menu = Submenu::with_items(
                handle,
                "File",
                true,
                &[
                    &MenuItem::with_id(handle, "new_project", "New Project", true, Some("cmd+n"))?,
                    &MenuItem::with_id(handle, "open_project", "Open Project...", true, Some("cmd+o"))?,
                    &MenuItem::with_id(handle, "save_project", "Save Project", true, Some("cmd+s"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::close_window(handle, Some("Close Window"))?,
                ],
            )?;

            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, Some("Undo"))?,
                    &PredefinedMenuItem::redo(handle, Some("Redo"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, Some("Cut"))?,
                    &PredefinedMenuItem::copy(handle, Some("Copy"))?,
                    &PredefinedMenuItem::paste(handle, Some("Paste"))?,
                    &PredefinedMenuItem::select_all(handle, Some("Select All"))?,
                ],
            )?;

            let view_menu = Submenu::with_items(
                handle,
                "View",
                true,
                &[
                    &PredefinedMenuItem::fullscreen(handle, Some("Toggle Fullscreen"))?,
                ],
            )?;

            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, Some("Minimize"))?,
                    &PredefinedMenuItem::maximize(handle, Some("Zoom"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::close_window(handle, Some("Close"))?,
                ],
            )?;

            let help_menu = Submenu::with_items(
                handle,
                "Help",
                true,
                &[
                     &MenuItem::with_id(handle, "open_help", "ProTakeoff Guide", true, None::<&str>)?,
                     &MenuItem::with_id(handle, "open_activation", "Activation", true, None::<&str>)?,
                ],
            )?;

            let menu = Menu::with_items(
                handle,
                &[
                    &app_menu,
                    &file_menu,
                    &edit_menu,
                    &view_menu,
                    &window_menu,
                    &help_menu,
                ],
            )?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "open_help" => {
                        let _ = app_handle.emit("open_help", ());
                    }
                    "open_activation" => {
                        let _ = app_handle.emit("open_activation", ());
                    }
                    "new_project" => {
                        let _ = app_handle.emit("new_project", ());
                    }
                    "open_project" => {
                        let _ = app_handle.emit("open_project", ());
                    }
                    "save_project" => {
                        let _ = app_handle.emit("save_project", ());
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            license::verify_license,
            license::get_machine_id,
            get_startup_args,
            read_file_binary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}