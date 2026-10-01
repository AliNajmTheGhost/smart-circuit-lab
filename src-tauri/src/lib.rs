//! The native shell around the web interface: file dialogs for `.nabd` circuits,
//! opening a circuit that was double-clicked, and one window even if the app is started twice.

mod files;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .invoke_handler(tauri::generate_handler![files::open_circuit, files::save_circuit, files::launch_file])
        .run(tauri::generate_context!())
        .expect("error while running Nabd");
}
