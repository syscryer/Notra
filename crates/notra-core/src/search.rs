use regex::{Regex, RegexBuilder};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchMode {
    Literal,
    Extended,
    Regex,
}

impl SearchMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::Literal => "普通",
            Self::Extended => "扩展",
            Self::Regex => "正则",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchOptions {
    pub mode: SearchMode,
    pub match_case: bool,
    pub whole_word: bool,
    pub wrap: bool,
    pub include_hidden: bool,
    pub recursive: bool,
    pub file_glob: String,
    pub skip_dirs: String,
    pub max_file_size: u64,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            mode: SearchMode::Literal,
            match_case: false,
            whole_word: false,
            wrap: true,
            include_hidden: false,
            recursive: true,
            file_glob: "*.*".to_owned(),
            skip_dirs: ".git;target;node_modules;.reference".to_owned(),
            max_file_size: 20 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextMatch {
    pub range: MatchRange,
    pub line: usize,
    pub column: usize,
    pub matched_text: String,
    pub line_text: String,
}

#[derive(Debug, Clone)]
pub struct ReplaceOutcome {
    pub text: String,
    pub count: usize,
    pub matches: Vec<TextMatch>,
}

pub(crate) struct SearchMatcher {
    pattern: Regex,
    whole_word: bool,
}

impl SearchMatcher {
    pub(crate) fn new(query: &str, options: &SearchOptions) -> Result<Self, SearchError> {
        Ok(Self {
            pattern: compile_pattern(query, options)?,
            whole_word: options.whole_word,
        })
    }

    pub(crate) fn find_all(&self, text: &str) -> Vec<TextMatch> {
        let ranges = self.matching_ranges(text);
        if ranges.is_empty() {
            return Vec::new();
        }

        let line_index = LineIndex::new(text);
        ranges
            .into_iter()
            .map(|(start, end)| line_index.match_from_range(text, start, end))
            .collect()
    }

    fn matching_ranges(&self, text: &str) -> Vec<(usize, usize)> {
        self.pattern
            .find_iter(text)
            .filter(|mat| mat.start() != mat.end())
            .filter(|mat| !self.whole_word || is_whole_word(text, mat.start(), mat.end()))
            .map(|mat| (mat.start(), mat.end()))
            .collect()
    }
}

#[derive(Debug, Clone)]
pub enum SearchError {
    EmptyQuery,
    InvalidRegex(String),
    ReadOnlyDocument(String),
}

impl std::fmt::Display for SearchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyQuery => write!(f, "查询内容不能为空"),
            Self::InvalidRegex(err) => write!(f, "正则表达式错误：{err}"),
            Self::ReadOnlyDocument(reason) => write!(f, "文档只读：{reason}"),
        }
    }
}

impl std::error::Error for SearchError {}

pub fn find_all(
    text: &str,
    query: &str,
    options: &SearchOptions,
) -> Result<Vec<TextMatch>, SearchError> {
    Ok(SearchMatcher::new(query, options)?.find_all(text))
}

pub fn preview_replace(
    text: &str,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
) -> Result<ReplaceOutcome, SearchError> {
    apply_replace_all(text, query, replacement, options)
}

pub fn apply_replace_all(
    text: &str,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
) -> Result<ReplaceOutcome, SearchError> {
    let matcher = SearchMatcher::new(query, options)?;
    Ok(apply_replace_all_with_matcher(
        text,
        replacement,
        options,
        &matcher,
    ))
}

pub(crate) fn apply_replace_all_with_matcher(
    text: &str,
    replacement: &str,
    options: &SearchOptions,
    matcher: &SearchMatcher,
) -> ReplaceOutcome {
    let matches = matcher.find_all(text);
    if matches.is_empty() {
        return ReplaceOutcome {
            text: text.to_owned(),
            count: 0,
            matches,
        };
    }

    if options.mode == SearchMode::Regex {
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        for m in &matches {
            out.push_str(&text[last..m.range.start]);
            out.push_str(
                &matcher
                    .pattern
                    .replace(&text[m.range.start..m.range.end], replacement),
            );
            last = m.range.end;
        }
        out.push_str(&text[last..]);
        ReplaceOutcome {
            text: out,
            count: matches.len(),
            matches,
        }
    } else {
        let replacement = normalized_replacement(replacement, options);
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        for m in &matches {
            out.push_str(&text[last..m.range.start]);
            out.push_str(&replacement);
            last = m.range.end;
        }
        out.push_str(&text[last..]);
        ReplaceOutcome {
            text: out,
            count: matches.len(),
            matches,
        }
    }
}

pub fn replacement_for_match(
    matched_text: &str,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
) -> Result<String, SearchError> {
    if options.mode == SearchMode::Regex {
        let regex = compile_pattern(query, options)?;
        Ok(regex.replace(matched_text, replacement).into_owned())
    } else {
        Ok(normalized_replacement(replacement, options))
    }
}

pub fn translate_extended(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('0') => out.push('\0'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

fn normalized_replacement(replacement: &str, options: &SearchOptions) -> String {
    if options.mode == SearchMode::Extended {
        translate_extended(replacement)
    } else {
        replacement.to_owned()
    }
}

fn compile_pattern(query: &str, options: &SearchOptions) -> Result<Regex, SearchError> {
    if query.is_empty() {
        return Err(SearchError::EmptyQuery);
    }
    let pattern = match options.mode {
        SearchMode::Literal => regex::escape(query),
        SearchMode::Extended => regex::escape(&translate_extended(query)),
        SearchMode::Regex => query.to_owned(),
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.match_case)
        .multi_line(true)
        .build()
        .map_err(|err| SearchError::InvalidRegex(err.to_string()))
}

struct LineIndex {
    starts: Vec<usize>,
}

impl LineIndex {
    fn new(text: &str) -> Self {
        let mut starts = vec![0];
        for (idx, byte) in text.bytes().enumerate() {
            if byte == b'\n' {
                starts.push(idx + 1);
            }
        }
        Self { starts }
    }

    fn match_from_range(&self, text: &str, start: usize, end: usize) -> TextMatch {
        let line_idx = self
            .starts
            .partition_point(|line_start| *line_start <= start)
            .saturating_sub(1);
        let line_start = self.starts[line_idx];
        let line_end = self
            .starts
            .get(line_idx + 1)
            .map(|next_line| next_line.saturating_sub(1))
            .unwrap_or(text.len());
        let column = text[line_start..start].chars().count() + 1;
        TextMatch {
            range: MatchRange { start, end },
            line: line_idx + 1,
            column,
            matched_text: text[start..end].to_owned(),
            line_text: text[line_start..line_end].to_owned(),
        }
    }
}

fn is_whole_word(text: &str, start: usize, end: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();
    !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char)
}

fn is_word_char(ch: char) -> bool {
    ch == '_' || ch.is_alphanumeric()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_search_is_case_insensitive_by_default() {
        let options = SearchOptions::default();
        let hits = find_all("Alpha alpha ALPHA", "alpha", &options).unwrap();
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].matched_text, "Alpha");
    }

    #[test]
    fn whole_word_filters_embedded_matches() {
        let options = SearchOptions {
            whole_word: true,
            ..Default::default()
        };
        let hits = find_all("cat scatter cat_ cat", "cat", &options).unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn search_reports_line_column_and_line_text() {
        let options = SearchOptions {
            match_case: true,
            ..Default::default()
        };
        let hits = find_all("one\ntwo target\nthree", "target", &options).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].column, 5);
        assert_eq!(hits[0].line_text, "two target");
    }

    #[test]
    fn extended_mode_translates_escape_sequences() {
        let options = SearchOptions {
            mode: SearchMode::Extended,
            ..Default::default()
        };
        let hits = find_all("a\nb\n", "\\n", &options).unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn matcher_can_be_reused_across_multiple_documents() {
        let options = SearchOptions {
            whole_word: true,
            ..Default::default()
        };
        let matcher = SearchMatcher::new("notra", &options).unwrap();

        let first = matcher.find_all("Notra is open");
        let second = matcher.find_all("notradamus notra");
        let empty = matcher.find_all("another editor");

        assert_eq!(first.len(), 1);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].column, 12);
        assert!(empty.is_empty());
    }

    #[test]
    fn matcher_rejects_invalid_regex_when_created() {
        let options = SearchOptions {
            mode: SearchMode::Regex,
            ..Default::default()
        };

        assert!(matches!(
            SearchMatcher::new("(", &options),
            Err(SearchError::InvalidRegex(_))
        ));
    }

    #[test]
    fn regex_replacement_supports_captures() {
        let options = SearchOptions {
            mode: SearchMode::Regex,
            match_case: true,
            ..Default::default()
        };
        let out = apply_replace_all("name=notra", r"name=(\w+)", "app=$1", &options).unwrap();
        assert_eq!(out.text, "app=notra");
        assert_eq!(out.count, 1);
    }

    #[test]
    fn extended_replacement_translates_escape_sequences() {
        let options = SearchOptions {
            mode: SearchMode::Extended,
            match_case: true,
            ..Default::default()
        };
        let out = apply_replace_all("alpha,beta", ",", "\\r\\n", &options).unwrap();
        assert_eq!(out.text, "alpha\r\nbeta");
    }

    #[test]
    fn current_match_replacement_uses_regex_captures() {
        let options = SearchOptions {
            mode: SearchMode::Regex,
            match_case: true,
            ..Default::default()
        };
        let replacement =
            replacement_for_match("name=notra", r"name=(\w+)", "app=$1", &options).unwrap();
        assert_eq!(replacement, "app=notra");
    }
}
