use notra_core::{SearchOptions, apply_replace_all, find_all, search_directory};
use std::fs;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut text = String::with_capacity(6 * 1024 * 1024);
    for i in 0..120_000 {
        text.push_str("line ");
        text.push_str(&i.to_string());
        text.push_str(" alpha beta gamma notra search replace payload\n");
    }

    let options = SearchOptions {
        match_case: false,
        ..Default::default()
    };

    let started = Instant::now();
    let hits = find_all(&text, "notra", &options)?;
    let search_ms = started.elapsed().as_millis();
    assert_eq!(hits.len(), 120_000);

    let started = Instant::now();
    let outcome = apply_replace_all(&text, "notra", "NOTRA", &options)?;
    let replace_ms = started.elapsed().as_millis();
    assert_eq!(outcome.count, 120_000);

    let root = std::env::temp_dir().join(format!("notra-perf-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root)?;
    for i in 0..160 {
        fs::write(
            root.join(format!("sample-{i:03}.txt")),
            "alpha\nnotra search target\nbeta\nnotra replace target\n",
        )?;
    }

    let dir_options = SearchOptions {
        file_glob: "*.txt".to_owned(),
        ..Default::default()
    };
    let started = Instant::now();
    let report = search_directory(&root, "notra", &dir_options)?;
    let dir_ms = started.elapsed().as_millis();
    let dir_hits: usize = report.hits.iter().map(|hit| hit.matches.len()).sum();
    assert_eq!(dir_hits, 320);

    fs::remove_dir_all(&root)?;

    println!("notra perf smoke");
    println!("memory_search_hits={}", hits.len());
    println!("memory_search_ms={search_ms}");
    println!("memory_replace_count={}", outcome.count);
    println!("memory_replace_ms={replace_ms}");
    println!("directory_files={}", report.hits.len());
    println!("directory_hits={dir_hits}");
    println!("directory_search_ms={dir_ms}");

    Ok(())
}
