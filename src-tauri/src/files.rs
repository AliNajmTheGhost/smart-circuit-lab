//! Opening and saving circuit files with the system's own dialogs.
//! Paths never come from the web page: the user picks them in a dialog, so the page cannot
//! read or write anything else on the computer.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::FsExt;

/// A circuit file read from disk.
#[derive(Serialize, Clone)]
pub struct OpenedFile {
    pub name: String,
    pub text: String,
}

/// Saved circuits use .sclab; files from before the new name (.nabd) and plain JSON still open.
const EXTENSIONS: [&str; 3] = ["sclab", "nabd", "json"];

/// The longest name offered in the save dialog, in characters (Arabic letters count as one).
const MAX_NAME: usize = 80;

/// The name a circuit is offered under comes from the web page, so it is reduced here to a plain
/// file name: the last segment only, nothing Windows forbids, and always `.sclab`. The student
/// still picks the folder in the system's own dialog; this only keeps the suggested name honest.
fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    // Drop an extension the page already added, so saving twice does not give "x.sclab.sclab".
    let n = trimmed.len();
    let stem = if n >= 6 && trimmed.is_char_boundary(n - 6) && trimmed[n - 6..].eq_ignore_ascii_case(".sclab") {
        &trimmed[..n - 6]
    } else {
        trimmed
    };
    let stem: String = stem.chars().take(MAX_NAME).collect();
    let stem = stem.trim();
    format!("{}.sclab", if stem.is_empty() { "circuit" } else { stem })
}

fn file_name(p: &FilePath) -> String {
    match p {
        FilePath::Path(path) => path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        FilePath::Url(url) => url.path_segments().and_then(|mut s| s.next_back()).map(|s| s.to_string()).unwrap_or_default(),
    }
}

fn read<R: Runtime>(app: &AppHandle<R>, p: FilePath) -> Result<OpenedFile, String> {
    let name = file_name(&p);
    let text = app.fs().read_to_string(p).map_err(|e| e.to_string())?;
    Ok(OpenedFile { name, text })
}

/// Ask for a circuit file and return its text, or nothing if the student cancelled.
#[tauri::command]
pub async fn open_circuit<R: Runtime>(app: AppHandle<R>) -> Result<Option<OpenedFile>, String> {
    let dialog = app.dialog().file();
    // Android filters by MIME type and has none for .nabd, so a filter would grey out the
    // student's own files. There the picker shows everything and importText rejects non-circuits.
    #[cfg(desktop)]
    let dialog = dialog.add_filter("مختبر الدوائر الذكية", &EXTENSIONS);
    let picked = dialog.blocking_pick_file();
    picked.map(|p| read(&app, p)).transpose()
}

/// Ask where to save and write the circuit there. Returns false if the student cancelled.
#[tauri::command]
pub async fn save_circuit<R: Runtime>(app: AppHandle<R>, name: String, text: String) -> Result<bool, String> {
    let Some(p) = app.dialog().file().add_filter("مختبر الدوائر الذكية", &["sclab"]).set_file_name(safe_file_name(&name)).blocking_save_file() else {
        return Ok(false);
    };
    let mut opts = tauri_plugin_fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    let mut f = app.fs().open(p, opts).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut f, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(true)
}

/// The circuit file the app was started with (double-click on a .nabd file), if any.
#[tauri::command]
pub fn launch_file<R: Runtime>(app: AppHandle<R>) -> Option<OpenedFile> {
    let args: Vec<String> = std::env::args().collect();
    launch_arg(&args).and_then(|p| read(&app, FilePath::Path(p)).ok())
}

fn launch_arg(argv: &[String]) -> Option<std::path::PathBuf> {
    argv.iter()
        .skip(1)
        .map(std::path::PathBuf::from)
        .find(|p| p.extension().is_some_and(|e| EXTENSIONS.iter().any(|x| e.eq_ignore_ascii_case(x))) && p.is_file())
}

/// A file passed to a second start of the app goes to the window that is already open.
#[cfg(desktop)]
pub fn forward_launch_file<R: Runtime>(app: &AppHandle<R>, argv: &[String]) {
    if let Some(f) = launch_arg(argv).and_then(|p| read(app, FilePath::Path(p)).ok()) {
        let _ = app.emit("open-file", f);
    }
}

#[cfg(test)]
mod tests {
    use super::safe_file_name;

    #[test]
    fn a_plain_name_keeps_its_arabic_letters_and_gains_the_extension() {
        assert_eq!(safe_file_name("دائرة المصباح"), "دائرة المصباح.sclab");
    }

    #[test]
    fn an_extension_the_page_added_is_not_doubled() {
        assert_eq!(safe_file_name("circuit.sclab"), "circuit.sclab");
        assert_eq!(safe_file_name("circuit.SCLAB"), "circuit.sclab");
    }

    #[test]
    fn directories_and_forbidden_characters_are_dropped() {
        // The folders are gone and the name still ends in .sclab, so Windows sees a circuit.
        assert_eq!(safe_file_name(r"..\..\Startup\run.bat"), "run.bat.sclab");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd.sclab");
        assert_eq!(safe_file_name("a:b*c?d\"e<f>g|h"), "abcdefgh.sclab");
        assert_eq!(safe_file_name("line\nbreak"), "linebreak.sclab");
    }

    #[test]
    fn an_empty_or_dotted_name_falls_back_to_circuit() {
        assert_eq!(safe_file_name(""), "circuit.sclab");
        assert_eq!(safe_file_name("   "), "circuit.sclab");
        assert_eq!(safe_file_name("..."), "circuit.sclab");
        assert_eq!(safe_file_name("C:\\"), "circuit.sclab");
    }

    #[test]
    fn a_very_long_name_is_cut_without_splitting_a_letter() {
        let out = safe_file_name(&"ش".repeat(500));
        assert_eq!(out, format!("{}.sclab", "ش".repeat(80)));
    }
}
