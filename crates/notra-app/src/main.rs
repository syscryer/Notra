#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod session_store;
mod shell_integration;

fn main() {
    app::run();
}
