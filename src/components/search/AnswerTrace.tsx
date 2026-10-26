import { useState } from "react";
import { ChevronDown, Database, Layers, Search as SearchIcon } from "lucide-react";
import { PMBadge } from "@/components/ui/pm-badge";
import { CodeBlock } from "./CodeBlock";

export interface SearchTrace {
  mode: "sql" | "vector" | "hybrid";
  router_reason?: string;
  router_confidence?: number;
  sql?: string;
  tables_used?: string[];
  row_count?: number;
  truncated?: boolean;
  model?: string;
  exec_ms?: number;
  evidence_chunks?: number;
}

/** Make the executed SQL readable: drop the per-user table prefix, collapse
 *  whitespace, and break before major clauses. Display-only — never re-executed. */
function formatSql(sql: string): string {
  return sql
    .replace(/u_[0-9a-f]{32}_/gi, "")                     // u_<uid>_accounts → accounts
    .replace(/\s+/g, " ")
    .replace(/\s+(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN|UNION ALL|UNION)\b/gi, "\n$1")
    .replace(/\(\s*1000\s*\)/g, "1000")                   // LIMIT (1000) → LIMIT 1000
    .trim();
}

const MODE_META: Record<SearchTrace["mode"], { label: string; icon: typeof Database; variant: "info" | "success" | "default" }> = {
  sql: { label: "SQL", icon: Database, variant: "success" },
  hybrid: { label: "Hybrid", icon: Layers, variant: "info" },
  vector: { label: "Search", icon: SearchIcon, variant: "default" },
};

/** "How I got this answer" — shows the retrieval mode, the SQL run, and tables/rows. */
export function AnswerTrace({ trace }: { trace: SearchTrace }) {
  const [open, setOpen] = useState(false);
  const meta = MODE_META[trace.mode] ?? MODE_META.vector;
  const Icon = meta.icon;

  return (
    <div className="mt-4 pt-3 border-t border-border/40">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <Icon className="h-3.5 w-3.5" />
        <span>How I got this answer</span>
        <PMBadge variant={meta.variant} className="text-[10px]">{meta.label}</PMBadge>
        {typeof trace.row_count === "number" && (
          <span className="text-[11px]">{trace.row_count} row{trace.row_count === 1 ? "" : "s"}</span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-2.5">
          {trace.router_reason && (
            <p className="text-[11px] text-muted-foreground">
              <span className="text-foreground/70">Why this mode:</span> {trace.router_reason}
              {typeof trace.router_confidence === "number" && ` (confidence ${trace.router_confidence})`}
            </p>
          )}
          {trace.sql && <CodeBlock code={formatSql(trace.sql)} language="sql" />}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {trace.tables_used?.length ? <span>Tables: {trace.tables_used.join(", ")}</span> : null}
            {trace.truncated ? <span className="text-amber-400">Truncated at 1000 rows</span> : null}
            {trace.evidence_chunks ? <span>Feedback evidence: {trace.evidence_chunks} chunk{trace.evidence_chunks === 1 ? "" : "s"}</span> : null}
            {trace.model ? <span>Model: {trace.model.replace(/-\d{8}$/, "")}</span> : null}
            {typeof trace.exec_ms === "number" ? <span>Query: {trace.exec_ms}ms</span> : null}
          </div>
        </div>
      )}
    </div>
  );
}
