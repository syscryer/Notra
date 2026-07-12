use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

const DATABASE_VERSION: i64 = 1;
const MAX_SESSION_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug)]
pub struct SessionStore {
    path: PathBuf,
}

impl SessionStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn initialize(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建应用数据目录失败：{}：{error}", parent.display()))?;
        }

        let mut connection = self.connect()?;
        let version = connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .map_err(database_error)?;

        match version {
            0 => {
                let transaction = connection.transaction().map_err(database_error)?;
                transaction
                    .execute_batch(
                        "CREATE TABLE session_state (
                            id INTEGER PRIMARY KEY CHECK (id = 1),
                            payload TEXT NOT NULL,
                            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                        );
                        PRAGMA user_version = 1;",
                    )
                    .map_err(database_error)?;
                transaction.commit().map_err(database_error)?;
            }
            DATABASE_VERSION => {}
            other => return Err(format!("不支持的会话数据库版本：{other}")),
        }

        Ok(())
    }

    pub fn load(&self) -> Result<Option<String>, String> {
        let connection = self.connect()?;
        connection
            .query_row(
                "SELECT payload FROM session_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(database_error)
    }

    pub fn save(&self, payload: &str) -> Result<(), String> {
        if payload.len() > MAX_SESSION_BYTES {
            return Err(format!(
                "会话数据超过限制：{} bytes（最大 {} bytes）",
                payload.len(),
                MAX_SESSION_BYTES
            ));
        }
        let value = serde_json::from_str::<Value>(payload)
            .map_err(|error| format!("会话数据不是有效 JSON：{error}"))?;
        if !value.is_object() {
            return Err("会话数据必须是 JSON 对象".to_owned());
        }

        let mut connection = self.connect()?;
        let transaction = connection.transaction().map_err(database_error)?;
        transaction
            .execute(
                "INSERT INTO session_state (id, payload, updated_at)
                 VALUES (1, ?1, unixepoch())
                 ON CONFLICT(id) DO UPDATE SET
                    payload = excluded.payload,
                    updated_at = excluded.updated_at",
                params![payload],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)
    }

    #[cfg(test)]
    fn path(&self) -> &Path {
        &self.path
    }

    fn connect(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.path).map_err(database_error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(database_error)?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA foreign_keys = ON;",
            )
            .map_err(database_error)?;
        Ok(connection)
    }
}

fn database_error(error: rusqlite::Error) -> String {
    format!("会话数据库操作失败：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_store(name: &str) -> SessionStore {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before Unix epoch")
            .as_nanos();
        SessionStore::new(std::env::temp_dir().join(format!(
            "notra-session-{name}-{}-{nonce}.db",
            std::process::id()
        )))
    }

    fn cleanup(store: &SessionStore) {
        for suffix in ["", "-shm", "-wal"] {
            let path = PathBuf::from(format!("{}{suffix}", store.path().display()));
            let _ = std::fs::remove_file(path);
        }
    }

    #[test]
    fn initializes_and_roundtrips_session() {
        let store = test_store("roundtrip");
        store.initialize().expect("initialize database");
        assert_eq!(store.load().expect("load empty database"), None);

        let first = r#"{"openFiles":["a.txt"],"activePath":"a.txt"}"#;
        store.save(first).expect("save first snapshot");
        assert_eq!(
            store.load().expect("load first snapshot").as_deref(),
            Some(first)
        );

        let second = r#"{"openFiles":[],"activePath":null}"#;
        store.save(second).expect("replace snapshot");
        assert_eq!(
            store.load().expect("load second snapshot").as_deref(),
            Some(second)
        );
        cleanup(&store);
    }

    #[test]
    fn rejects_invalid_session_payload() {
        let store = test_store("invalid");
        store.initialize().expect("initialize database");
        assert!(store.save("not json").is_err());
        assert!(store.save("[]").is_err());
        cleanup(&store);
    }
}
