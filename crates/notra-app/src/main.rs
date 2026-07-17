#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("Notra release builds must enable the custom-protocol feature");

mod app;
mod session_store;
mod shell_integration;

fn main() {
    app::run();
}
