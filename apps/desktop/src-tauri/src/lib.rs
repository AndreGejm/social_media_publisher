mod commands;

use tracing_subscriber::{fmt, EnvFilter};

pub fn run() {
    let _ = fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .try_init();

    let app = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        commands::load_spec,
        commands::plan_release,
        commands::execute_release,
        commands::list_history,
        commands::get_report
    ]);

    if let Err(error) = app.run(tauri::generate_context!()) {
        tracing::error!(target: "desktop", error = %error, "tauri application failed to run");
        std::process::exit(1);
    }
}
