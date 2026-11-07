mod sim;

use sim::SimResult;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const MAX_TEXT: usize = 100 * 1024;
const MAX_NAME: usize = 40;

/// Windows の予約デバイス名（拡張子付きでも予約扱い）
fn is_reserved(name: &str) -> bool {
    let stem = name.trim().to_ascii_uppercase();
    let stem = stem.split('.').next().unwrap_or("").trim_end();
    matches!(stem, "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

fn valid_name(name: &str) -> bool {
    let n = name.chars().count();
    n > 0
        && !is_reserved(name)
        && n <= MAX_NAME
        && !name.trim().is_empty()
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '＋' | '・' | ' ' | '　'))
}

fn rules_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("rules");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn rule_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("名前に使えるのは文字・数字・- _ ＋ ・ と空白だけです（40文字まで）".into());
    }
    Ok(rules_dir(app)?.join(format!("{}.clip", name)))
}

#[tauri::command]
fn list_rules(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = rules_dir(&app)?;
    let mut names: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("clip") {
                p.file_stem().and_then(|s| s.to_str()).map(String::from)
            } else {
                None
            }
        })
        .filter(|n| valid_name(n))
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
fn save_rules(app: tauri::AppHandle, name: String, text: String) -> Result<(), String> {
    if text.len() > MAX_TEXT {
        return Err("テキストが大きすぎます（100KBまで）".into());
    }
    let path = rule_path(&app, &name)?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_rules(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let path = rule_path(&app, &name)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() as usize > MAX_TEXT {
        return Err("ファイルが大きすぎます（100KBまで）".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

// 重い計算でメインスレッド（UI）を止めないよう、ブロッキング用スレッドで実行する
#[tauri::command]
async fn simulate_batch(
    texts: Vec<String>,
    ticks: u64,
    every: u64,
) -> Result<Vec<SimResult>, String> {
    if texts.len() > 32 || ticks > 100_000 || texts.iter().any(|t| t.len() > MAX_TEXT) {
        return Err("リクエストが大きすぎます".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        texts.iter().map(|t| sim::simulate(t, ticks, every)).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::valid_name;

    #[test]
    fn names() {
        for ok in ["抑止", "取引＋収容", "a b-c_d・e", "console", "COM10", "COM0"] {
            assert!(valid_name(ok), "{}", ok);
        }
        for bad in ["", "  ", "..", "a/b", "a.b", "CON", "con", "NUL ", "com1", "LPT9", &"あ".repeat(41)] {
            assert!(!valid_name(bad), "{}", bad);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_rules,
            save_rules,
            load_rules,
            simulate_batch
        ])
        .run(tauri::generate_context!())
        .expect("Tauri の起動に失敗しました");
}
