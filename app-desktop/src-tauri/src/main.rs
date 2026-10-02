// app-desktop/src-tauri/src/main.rs — skeleton V1. Hanya greet; perintah
// screen_capture / hotkey / TTS nyusul setelah compile pertama sukses.
// TTS (Windows OneCore) PALING AKHIR sesuai scope.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Halo, {}! Saya Tuton Jarvis (shell V1).", name)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("gagal jalan Tuton Jarvis");
}
