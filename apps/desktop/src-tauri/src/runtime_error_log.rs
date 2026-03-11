use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tracing_subscriber::{
    filter::LevelFilter,
    fmt,
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
    Layer,
};

const RUNTIME_ERROR_LOG_FILE_NAME: &str = "runtime-errors.log";
const RUNTIME_ERROR_LOG_ARCHIVE_FILE_NAME: &str = "runtime-errors.previous.log";
const MAX_RUNTIME_ERROR_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_STRING_CHARS: usize = 2048;
const MAX_OBJECT_PROPERTIES: usize = 32;
const MAX_ARRAY_ITEMS: usize = 32;
const MAX_JSON_DEPTH: usize = 5;

static INITIALIZED: OnceLock<()> = OnceLock::new();
static RUNTIME_ERROR_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn initialize(app: &AppHandle) {
    let maybe_log_path = resolve_runtime_error_log_path(app).ok();

    if let Some(log_path) = maybe_log_path.as_ref() {
        let _ = RUNTIME_ERROR_LOG_PATH.set(log_path.clone());
    }

    if INITIALIZED.set(()).is_err() {
        return;
    }

    let env_filter = EnvFilter::from_default_env();
    let stdout_layer = fmt::layer().with_target(false);
    let subscriber = tracing_subscriber::registry().with(env_filter).with(stdout_layer);

    if let Some(log_path) = maybe_log_path {
        let file_path = log_path.clone();
        let file_layer = fmt::layer()
            .json()
            .with_target(true)
            .with_level(true)
            .with_writer(move || -> Box<dyn Write + Send> {
                match RuntimeErrorLogWriter::new(file_path.clone()) {
                    Ok(writer) => Box::new(writer),
                    Err(_) => Box::new(io::sink()),
                }
            })
            .with_filter(LevelFilter::WARN);

        let _ = subscriber.with(file_layer).try_init();
    } else {
        let _ = subscriber.try_init();
    }

    install_panic_hook();
}

pub(crate) fn resolve_runtime_error_log_path(app: &AppHandle) -> io::Result<PathBuf> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
    Ok(log_dir.join(RUNTIME_ERROR_LOG_FILE_NAME))
}

pub(crate) fn append_frontend_runtime_error(
    app: &AppHandle,
    source: &str,
    message: &str,
    details: Option<Value>,
) -> io::Result<PathBuf> {
    let path = if let Some(path) = RUNTIME_ERROR_LOG_PATH.get() {
        path.clone()
    } else {
        let path = resolve_runtime_error_log_path(app)?;
        let _ = RUNTIME_ERROR_LOG_PATH.set(path.clone());
        path
    };

    prepare_runtime_error_log_path(&path)?;

    let payload = json!({
        "timestamp_utc": iso_timestamp(),
        "kind": "frontend_runtime_error",
        "source": sanitize_string(source),
        "message": sanitize_string(message),
        "details": details.map(|value| sanitize_json_value(value, 0))
    });

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    serde_json::to_writer(&mut file, &payload)?;
    file.write_all(b"\n")?;
    Ok(path)
}

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        if let Some(path) = RUNTIME_ERROR_LOG_PATH.get() {
            let payload = json!({
                "timestamp_utc": iso_timestamp(),
                "kind": "panic",
                "message": sanitize_string(&panic_info.to_string())
            });

            if prepare_runtime_error_log_path(path).is_ok() {
                if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
                    let _ = serde_json::to_writer(&mut file, &payload);
                    let _ = file.write_all(b"\n");
                }
            }
        }

        default_hook(panic_info);
    }));
}

fn iso_timestamp() -> String {
    let now: DateTime<Utc> = DateTime::from(std::time::SystemTime::now());
    now.to_rfc3339()
}

fn sanitize_string(value: &str) -> String {
    let trimmed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.chars().count() <= MAX_STRING_CHARS {
        return trimmed;
    }

    let mut truncated = trimmed.chars().take(MAX_STRING_CHARS).collect::<String>();
    truncated.push_str("...");
    truncated
}

fn sanitize_json_value(value: Value, depth: usize) -> Value {
    if depth >= MAX_JSON_DEPTH {
        return Value::String("<max-depth-reached>".to_string());
    }

    match value {
        Value::String(text) => Value::String(sanitize_string(&text)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .take(MAX_ARRAY_ITEMS)
                .map(|item| sanitize_json_value(item, depth + 1))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .take(MAX_OBJECT_PROPERTIES)
                .map(|(key, item)| (sanitize_string(&key), sanitize_json_value(item, depth + 1)))
                .collect(),
        ),
        other => other,
    }
}

fn prepare_runtime_error_log_path(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    if let Ok(metadata) = fs::metadata(path) {
        if metadata.len() >= MAX_RUNTIME_ERROR_LOG_BYTES {
            let archive_path = path.with_file_name(RUNTIME_ERROR_LOG_ARCHIVE_FILE_NAME);
            if archive_path.exists() {
                fs::remove_file(&archive_path)?;
            }
            fs::rename(path, archive_path)?;
        }
    }

    Ok(())
}

struct RuntimeErrorLogWriter {
    file: File,
}

impl RuntimeErrorLogWriter {
    fn new(path: PathBuf) -> io::Result<Self> {
        prepare_runtime_error_log_path(&path)?;
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(Self { file })
    }
}

impl Write for RuntimeErrorLogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.file.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}


