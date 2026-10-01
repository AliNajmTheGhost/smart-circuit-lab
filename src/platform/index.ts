/**
 * Where the program is running: the installed app (Windows, Android) or a web browser.
 * Everything that differs between them (files, sounds, storage paths) goes through this folder,
 * so the rest of the interface does not care.
 */
export const isApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
