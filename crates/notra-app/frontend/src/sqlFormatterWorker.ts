import { format } from "sql-formatter";

interface SqlFormatRequest {
  id: number;
  source: string;
  tabSize: number;
  useTabs: boolean;
}

interface SqlFormatResponse {
  id: number;
  text?: string;
  error?: string;
}

// Keep common projection lists and INSERT rows intact, close to DataGrip's
// default density, without forcing genuinely large expressions onto one line.
const DEFAULT_EXPRESSION_WIDTH = 220;

self.addEventListener("message", (event: MessageEvent<SqlFormatRequest>) => {
  const { id, source, tabSize, useTabs } = event.data;
  let response: SqlFormatResponse;
  try {
    response = {
      id,
      text: compactSqlLayout(format(source, {
        language: "sql",
        tabWidth: Math.max(1, tabSize),
        useTabs,
        keywordCase: "upper",
        expressionWidth: DEFAULT_EXPRESSION_WIDTH,
        linesBetweenQueries: 1,
        logicalOperatorNewline: "before",
      }), DEFAULT_EXPRESSION_WIDTH),
    };
  } catch (error) {
    response = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
});

function compactSqlLayout(sql: string, expressionWidth: number) {
  let compacted = compactSimpleCaseExpressions(sql);
  const lines = compacted.split("\n");
  const output: string[] = [];
  const clauseOnly = /^(\s*)(WITH|SELECT|FROM|WHERE|HAVING|GROUP BY|ORDER BY|LIMIT|VALUES|SET|RETURNING|UNION(?: ALL)?|INSERT INTO|UPDATE|DELETE FROM)\s*$/i;

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    const clause = line.match(clauseOnly);
    const nextClauseLine = lines[index + 1]?.trim();
    if (clause && nextClauseLine && !/^(--|\/\*)/.test(nextClauseLine)) {
      line = `${clause[1]}${clause[2]} ${lines[++index].trim()}`;
    }

    if (/^\s*SELECT\b/i.test(line)) {
      while (lines[index + 1]?.trim()) {
        const next = lines[index + 1].trim();
        if (/^(?:--|\/\*|\)|;|(?:FROM|WHERE|HAVING|GROUP BY|ORDER BY|LIMIT|VALUES|SET|RETURNING|UNION(?: ALL)?|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|AND|OR|WHEN|ELSE|END)\b)/i.test(next)) break;
        const candidate = `${line} ${next}`;
        if (candidate.trim().length > expressionWidth) break;
        line = candidate;
        index += 1;
      }
    }
    output.push(line);
  }

  compacted = output.join("\n");
  return compacted.replace(/\n{3,}/g, "\n\n").trim();
}

function compactSimpleCaseExpressions(sql: string) {
  return sql.replace(
    /(MAX|MIN|SUM|COUNT|COALESCE|NVL)\(\s*\n\s*CASE\s*\n\s*WHEN\s+([^\n]+)\s*\n\s*ELSE\s+([^\n]+)\s*\n\s*END\s*\n\s*\)/g,
    (_match, functionName: string, whenClause: string, elseClause: string) =>
      `${functionName}(CASE WHEN ${whenClause.trim()} ELSE ${elseClause.trim()} END)`,
  );
}

export {};
