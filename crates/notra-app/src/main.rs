#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod app;
mod session_store;
mod shell_integration;

fn main() {
    app::run();
}
