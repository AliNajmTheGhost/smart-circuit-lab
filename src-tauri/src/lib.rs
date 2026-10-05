//! The native shell around the web interface: file dialogs for `.nabd` circuits,
//! opening a circuit that was double-clicked, and one window even if the app is started twice.

mod files;

use tauri::Manager;

/// Version 0.2.0 registered the web version's offline service worker inside the app too. It then
/// kept serving the old page after an update, pointing at script files that no longer exist, and
/// the app stayed on the loading screen. The app's files are already on the device and it never
/// registers a worker now, so the worker's storage is removed before the window opens.
#[cfg(windows)]
fn remove_stale_service_worker() {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let dir = std::path::Path::new(&local).join("app.nabd.lab").join("EBWebView").join("Default").join("Service Worker");
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// The project's page (source code, releases, contact). The only address the interface may open.
const PROJECT_PAGE: &str = "https://github.com/AliNajmTheGhost/smart-circuit-lab";

/// Open the project's page in the system browser (from «حول البرنامج»).
#[tauri::command]
fn open_project_page<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(PROJECT_PAGE, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    remove_stale_service_worker();

    // Only desktop adds plugins before the common ones.
    #[cfg_attr(mobile, allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    // A second start (e.g. double-clicking another .nabd file) hands its file to the open window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            files::forward_launch_file(app, &argv);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![files::open_circuit, files::save_circuit, files::launch_file, open_project_page])
        .run(tauri::generate_context!())
        .expect("error while running Smart Circuit Lab");
}
