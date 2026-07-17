use serde::Serialize;
use std::path::Path;

const SHELL_MENU_LABEL: &str = "以 Notra 打开";
const DEFAULT_APP_LABEL: &str = "Windows 默认应用候选";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    pub supported: bool,
    pub enabled: bool,
    pub label: String,
    pub detail: String,
}

pub fn status() -> Result<ShellIntegrationStatus, String> {
    if !production_system_integration_enabled() {
        return Ok(development_status(SHELL_MENU_LABEL));
    }
    platform::context_menu_status()
}

pub fn set_enabled(enabled: bool) -> Result<ShellIntegrationStatus, String> {
    if !production_system_integration_enabled() {
        return Ok(development_status(SHELL_MENU_LABEL));
    }
    platform::set_context_menu_enabled(enabled)
}

pub fn default_app_status() -> Result<ShellIntegrationStatus, String> {
    if !production_system_integration_enabled() {
        return Ok(development_status(DEFAULT_APP_LABEL));
    }
    platform::default_app_status()
}

pub fn set_default_app_enabled(enabled: bool) -> Result<ShellIntegrationStatus, String> {
    if !production_system_integration_enabled() {
        return Ok(development_status(DEFAULT_APP_LABEL));
    }
    platform::set_default_app_enabled(enabled)
}

fn production_system_integration_enabled() -> bool {
    cfg!(feature = "custom-protocol")
}

fn development_status(label: &str) -> ShellIntegrationStatus {
    ShellIntegrationStatus {
        supported: false,
        enabled: false,
        label: label.to_owned(),
        detail: "开发模式不会修改 Windows 系统集成，请使用安装版本配置".to_owned(),
    }
}

fn shell_command(executable: &Path) -> String {
    format!("\"{}\" \"%1\"", executable.display())
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{DEFAULT_APP_LABEL, SHELL_MENU_LABEL, ShellIntegrationStatus, shell_command};
    use std::io;
    use std::path::PathBuf;
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    const MANAGED_VALUE: &str = "NotraManaged";
    const MANAGED_ID: &str = "dev.notra.app";

    const SHELL_KEY: &str = r"Software\Classes\*\shell\Notra.OpenWith";
    const SHELL_COMMAND_KEY: &str = r"Software\Classes\*\shell\Notra.OpenWith\command";

    const REGISTERED_APPLICATIONS_KEY: &str = r"Software\RegisteredApplications";
    const REGISTERED_APPLICATION_VALUE: &str = "Notra";
    const APPLICATION_KEY: &str = r"Software\Classes\Applications\notra.exe";
    const APPLICATION_COMMAND_KEY: &str =
        r"Software\Classes\Applications\notra.exe\shell\open\command";
    const SUPPORTED_TYPES_KEY: &str = r"Software\Classes\Applications\notra.exe\SupportedTypes";
    const CAPABILITIES_KEY: &str = r"Software\Classes\Applications\notra.exe\Capabilities";
    const FILE_ASSOCIATIONS_KEY: &str =
        r"Software\Classes\Applications\notra.exe\Capabilities\FileAssociations";
    const PROGID: &str = "Notra.Document";
    const PROGID_KEY: &str = r"Software\Classes\Notra.Document";
    const PROGID_ICON_KEY: &str = r"Software\Classes\Notra.Document\DefaultIcon";
    const PROGID_COMMAND_KEY: &str = r"Software\Classes\Notra.Document\shell\open\command";

    const DEFAULT_APP_EXTENSIONS: &[&str] = &[
        ".txt",
        ".text",
        ".log",
        ".md",
        ".markdown",
        ".mdx",
        ".rmd",
        ".csv",
        ".tsv",
        ".json",
        ".jsonc",
        ".toml",
        ".yaml",
        ".yml",
        ".xml",
        ".ini",
        ".cfg",
        ".conf",
        ".properties",
        ".sql",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".py",
        ".pyw",
        ".java",
        ".rs",
        ".go",
        ".c",
        ".h",
        ".cc",
        ".cpp",
        ".cxx",
        ".hpp",
        ".cs",
        ".php",
        ".rb",
        ".sh",
        ".ps1",
        ".bat",
        ".cmd",
        ".html",
        ".htm",
        ".css",
        ".scss",
        ".less",
    ];

    pub fn context_menu_status() -> Result<ShellIntegrationStatus, String> {
        let executable = current_executable()?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let shell_key = match hkcu.open_subkey(SHELL_KEY) {
            Ok(key) => key,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(context_menu_disabled_status());
            }
            Err(error) => return Err(registry_error("读取右键菜单状态", error)),
        };
        if managed_id(&shell_key) != MANAGED_ID {
            return Ok(ShellIntegrationStatus {
                supported: true,
                enabled: false,
                label: SHELL_MENU_LABEL.to_owned(),
                detail: "检测到同名的非 Notra 菜单项，未进行修改".to_owned(),
            });
        }
        let command = hkcu
            .open_subkey(SHELL_COMMAND_KEY)
            .and_then(|key| key.get_value::<String, _>(""));
        let expected = shell_command(&executable);
        match command {
            Ok(command) if command == expected => Ok(ShellIntegrationStatus {
                supported: true,
                enabled: true,
                label: SHELL_MENU_LABEL.to_owned(),
                detail: "已添加到当前用户的文件右键菜单".to_owned(),
            }),
            Ok(_) => Ok(ShellIntegrationStatus {
                supported: true,
                enabled: false,
                label: SHELL_MENU_LABEL.to_owned(),
                detail: "菜单项路径已变化，重新开启即可修复".to_owned(),
            }),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(ShellIntegrationStatus {
                supported: true,
                enabled: false,
                label: SHELL_MENU_LABEL.to_owned(),
                detail: "菜单项不完整，重新开启即可修复".to_owned(),
            }),
            Err(error) => Err(registry_error("读取右键菜单命令", error)),
        }
    }

    pub fn set_context_menu_enabled(enabled: bool) -> Result<ShellIntegrationStatus, String> {
        let executable = current_executable()?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            ensure_owned_or_missing(&hkcu, SHELL_KEY, "右键菜单项")?;
            let (shell_key, _) = hkcu
                .create_subkey(SHELL_KEY)
                .map_err(|error| registry_error("创建右键菜单项", error))?;
            let icon = executable_icon(&executable);
            shell_key
                .set_value("", &SHELL_MENU_LABEL)
                .and_then(|_| shell_key.set_value("Icon", &icon))
                .and_then(|_| shell_key.set_value(MANAGED_VALUE, &MANAGED_ID))
                .map_err(|error| registry_error("写入右键菜单项", error))?;
            let (command_key, _) = hkcu
                .create_subkey(SHELL_COMMAND_KEY)
                .map_err(|error| registry_error("创建右键菜单命令", error))?;
            command_key
                .set_value("", &shell_command(&executable))
                .map_err(|error| registry_error("写入右键菜单命令", error))?;
        } else {
            delete_owned_key(&hkcu, SHELL_KEY, "右键菜单项")?;
        }
        context_menu_status()
    }

    pub fn default_app_status() -> Result<ShellIntegrationStatus, String> {
        let executable = current_executable()?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let registered = match hkcu
            .open_subkey(REGISTERED_APPLICATIONS_KEY)
            .and_then(|key| key.get_value::<String, _>(REGISTERED_APPLICATION_VALUE))
        {
            Ok(path) => path,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(default_app_disabled_status());
            }
            Err(error) => return Err(registry_error("读取默认应用候选状态", error)),
        };
        if registered != CAPABILITIES_KEY {
            return Ok(ShellIntegrationStatus {
                supported: true,
                enabled: false,
                label: DEFAULT_APP_LABEL.to_owned(),
                detail: "检测到同名的其他默认应用注册，未进行修改".to_owned(),
            });
        }
        let application = hkcu
            .open_subkey(APPLICATION_KEY)
            .map_err(|error| registry_error("读取默认应用信息", error))?;
        if managed_id(&application) != MANAGED_ID {
            return Ok(ShellIntegrationStatus {
                supported: true,
                enabled: false,
                label: DEFAULT_APP_LABEL.to_owned(),
                detail: "默认应用候选信息不属于 Notra，未进行修改".to_owned(),
            });
        }
        let command = hkcu
            .open_subkey(APPLICATION_COMMAND_KEY)
            .and_then(|key| key.get_value::<String, _>(""));
        let association = hkcu
            .open_subkey(FILE_ASSOCIATIONS_KEY)
            .and_then(|key| key.get_value::<String, _>(".txt"));
        let expected_command = shell_command(&executable);
        if matches!(command, Ok(ref value) if value == &expected_command)
            && matches!(association, Ok(ref value) if value == PROGID)
        {
            Ok(ShellIntegrationStatus {
                supported: true,
                enabled: true,
                label: DEFAULT_APP_LABEL.to_owned(),
                detail: "已注册，可在 Windows 默认应用中选择文件类型".to_owned(),
            })
        } else {
            Ok(ShellIntegrationStatus {
                supported: true,
                enabled: false,
                label: DEFAULT_APP_LABEL.to_owned(),
                detail: "候选信息不完整，重新开启即可修复".to_owned(),
            })
        }
    }

    pub fn set_default_app_enabled(enabled: bool) -> Result<ShellIntegrationStatus, String> {
        let executable = current_executable()?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            ensure_owned_or_missing(&hkcu, APPLICATION_KEY, "默认应用候选")?;
            ensure_owned_or_missing(&hkcu, PROGID_KEY, "Notra 文档类型")?;
            let command = shell_command(&executable);
            let icon = executable_icon(&executable);

            let (application, _) = hkcu
                .create_subkey(APPLICATION_KEY)
                .map_err(|error| registry_error("创建默认应用候选", error))?;
            application
                .set_value("FriendlyAppName", &"Notra")
                .and_then(|_| application.set_value(MANAGED_VALUE, &MANAGED_ID))
                .map_err(|error| registry_error("写入默认应用候选", error))?;

            let (application_command, _) = hkcu
                .create_subkey(APPLICATION_COMMAND_KEY)
                .map_err(|error| registry_error("创建默认应用打开命令", error))?;
            application_command
                .set_value("", &command)
                .map_err(|error| registry_error("写入默认应用打开命令", error))?;

            let (supported_types, _) = hkcu
                .create_subkey(SUPPORTED_TYPES_KEY)
                .map_err(|error| registry_error("创建支持的文件类型列表", error))?;
            let (capabilities, _) = hkcu
                .create_subkey(CAPABILITIES_KEY)
                .map_err(|error| registry_error("创建默认应用能力信息", error))?;
            capabilities
                .set_value("ApplicationName", &"Notra")
                .and_then(|_| {
                    capabilities.set_value(
                        "ApplicationDescription",
                        &"Notra 文本、Markdown 与代码编辑器",
                    )
                })
                .and_then(|_| capabilities.set_value("ApplicationIcon", &icon))
                .map_err(|error| registry_error("写入默认应用能力信息", error))?;
            let (associations, _) = hkcu
                .create_subkey(FILE_ASSOCIATIONS_KEY)
                .map_err(|error| registry_error("创建默认应用文件类型列表", error))?;
            for extension in DEFAULT_APP_EXTENSIONS {
                supported_types
                    .set_value(*extension, &"")
                    .and_then(|_| associations.set_value(*extension, &PROGID))
                    .map_err(|error| registry_error("写入默认应用文件类型", error))?;
            }

            let (progid, _) = hkcu
                .create_subkey(PROGID_KEY)
                .map_err(|error| registry_error("创建 Notra 文档类型", error))?;
            progid
                .set_value("", &"Notra 文档")
                .and_then(|_| progid.set_value(MANAGED_VALUE, &MANAGED_ID))
                .map_err(|error| registry_error("写入 Notra 文档类型", error))?;
            let (progid_icon, _) = hkcu
                .create_subkey(PROGID_ICON_KEY)
                .map_err(|error| registry_error("创建 Notra 文档图标", error))?;
            progid_icon
                .set_value("", &icon)
                .map_err(|error| registry_error("写入 Notra 文档图标", error))?;
            let (progid_command, _) = hkcu
                .create_subkey(PROGID_COMMAND_KEY)
                .map_err(|error| registry_error("创建 Notra 文档打开命令", error))?;
            progid_command
                .set_value("", &command)
                .map_err(|error| registry_error("写入 Notra 文档打开命令", error))?;

            let (registered_apps, _) = hkcu
                .create_subkey(REGISTERED_APPLICATIONS_KEY)
                .map_err(|error| registry_error("打开默认应用注册列表", error))?;
            registered_apps
                .set_value(REGISTERED_APPLICATION_VALUE, &CAPABILITIES_KEY)
                .map_err(|error| registry_error("注册 Notra 默认应用候选", error))?;
        } else {
            if let Ok(registered_apps) = hkcu.open_subkey_with_flags(
                REGISTERED_APPLICATIONS_KEY,
                winreg::enums::KEY_READ | winreg::enums::KEY_WRITE,
            ) {
                match registered_apps.get_value::<String, _>(REGISTERED_APPLICATION_VALUE) {
                    Ok(path) if path == CAPABILITIES_KEY => {
                        registered_apps
                            .delete_value(REGISTERED_APPLICATION_VALUE)
                            .map_err(|error| registry_error("移除默认应用候选", error))?;
                    }
                    Ok(_) => return Err("同名默认应用候选不属于 Notra，未执行删除".to_owned()),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(registry_error("读取默认应用候选", error)),
                }
            }
            delete_owned_key(&hkcu, APPLICATION_KEY, "默认应用候选")?;
        }
        default_app_status()
    }

    fn current_executable() -> Result<PathBuf, String> {
        std::env::current_exe().map_err(|error| format!("无法获取 Notra 程序路径：{error}"))
    }

    fn executable_icon(executable: &PathBuf) -> String {
        format!("\"{}\",0", executable.display())
    }

    fn managed_id(key: &RegKey) -> String {
        key.get_value::<String, _>(MANAGED_VALUE)
            .unwrap_or_default()
    }

    fn ensure_owned_or_missing(hkcu: &RegKey, path: &str, label: &str) -> Result<(), String> {
        match hkcu.open_subkey(path) {
            Ok(existing) if managed_id(&existing) != MANAGED_ID => {
                Err(format!("存在同名的非 Notra {label}，无法安全覆盖"))
            }
            Ok(_) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(registry_error(&format!("读取{label}"), error)),
        }
    }

    fn delete_owned_key(hkcu: &RegKey, path: &str, label: &str) -> Result<(), String> {
        match hkcu.open_subkey(path) {
            Ok(existing) if managed_id(&existing) != MANAGED_ID => {
                Err(format!("同名{label}不属于 Notra，未执行删除"))
            }
            Ok(_) => hkcu
                .delete_subkey_all(path)
                .map_err(|error| registry_error(&format!("移除{label}"), error)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(registry_error(&format!("读取{label}"), error)),
        }
    }

    fn context_menu_disabled_status() -> ShellIntegrationStatus {
        ShellIntegrationStatus {
            supported: true,
            enabled: false,
            label: SHELL_MENU_LABEL.to_owned(),
            detail: "未添加文件右键菜单".to_owned(),
        }
    }

    fn default_app_disabled_status() -> ShellIntegrationStatus {
        ShellIntegrationStatus {
            supported: true,
            enabled: false,
            label: DEFAULT_APP_LABEL.to_owned(),
            detail: "尚未注册到 Windows 默认应用候选列表".to_owned(),
        }
    }

    fn registry_error(action: &str, error: io::Error) -> String {
        format!("{action}失败：{error}")
    }

    #[cfg(test)]
    pub(super) fn context_menu_registration_exists_for_test() -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(SHELL_KEY)
            .is_ok()
    }

    #[cfg(test)]
    pub(super) fn default_app_registration_exists_for_test() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if hkcu.open_subkey(APPLICATION_KEY).is_ok() || hkcu.open_subkey(PROGID_KEY).is_ok() {
            return true;
        }

        hkcu.open_subkey(REGISTERED_APPLICATIONS_KEY)
            .and_then(|key| key.get_value::<String, _>(REGISTERED_APPLICATION_VALUE))
            .is_ok()
    }

    #[cfg(test)]
    pub(super) fn remove_candidate_progid_for_test() {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = delete_owned_key(&hkcu, PROGID_KEY, "Notra 文档类型");
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::{DEFAULT_APP_LABEL, SHELL_MENU_LABEL, ShellIntegrationStatus};

    pub fn context_menu_status() -> Result<ShellIntegrationStatus, String> {
        unsupported(
            SHELL_MENU_LABEL,
            "当前版本仅支持 Windows 资源管理器右键菜单",
        )
    }

    pub fn set_context_menu_enabled(_enabled: bool) -> Result<ShellIntegrationStatus, String> {
        context_menu_status()
    }

    pub fn default_app_status() -> Result<ShellIntegrationStatus, String> {
        unsupported(DEFAULT_APP_LABEL, "当前版本仅支持 Windows 默认应用候选注册")
    }

    pub fn set_default_app_enabled(_enabled: bool) -> Result<ShellIntegrationStatus, String> {
        default_app_status()
    }

    fn unsupported(label: &str, detail: &str) -> Result<ShellIntegrationStatus, String> {
        Ok(ShellIntegrationStatus {
            supported: false,
            enabled: false,
            label: label.to_owned(),
            detail: detail.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn shell_command_quotes_executable_and_file_placeholder() {
        let executable = PathBuf::from(r"C:\Program Files\Notra\notra.exe");
        assert_eq!(
            shell_command(&executable),
            r#""C:\Program Files\Notra\notra.exe" "%1""#
        );
    }

    #[cfg(not(feature = "custom-protocol"))]
    #[test]
    fn development_build_does_not_enable_system_integration() {
        let status = status().expect("development status");
        assert!(!status.supported);
        assert!(!status.enabled);
        assert!(status.detail.contains("开发模式"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "temporarily modifies the current-user Explorer context menu"]
    fn registers_and_removes_current_user_context_menu() {
        if platform::context_menu_registration_exists_for_test() {
            eprintln!("skipping because a context-menu registration already exists");
            return;
        }

        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = set_enabled(false);
            }
        }

        let _cleanup = Cleanup;
        assert!(set_enabled(true).expect("register context menu").enabled);
        assert!(!set_enabled(false).expect("remove context menu").enabled);
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "temporarily modifies the current-user Default Apps candidates"]
    fn registers_and_removes_default_app_candidate() {
        if platform::default_app_registration_exists_for_test() {
            eprintln!("skipping because a default-app registration already exists");
            return;
        }

        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = set_default_app_enabled(false);
                platform::remove_candidate_progid_for_test();
            }
        }

        let _cleanup = Cleanup;
        assert!(
            set_default_app_enabled(true)
                .expect("register default app candidate")
                .enabled
        );
        assert!(
            !set_default_app_enabled(false)
                .expect("remove default app candidate")
                .enabled
        );
    }
}
