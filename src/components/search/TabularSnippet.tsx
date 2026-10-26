import { cn } from "@/lib/utils";

interface TabularSnippetProps {
  csv: string;
  className?: string;
}

const MAX_CELL_LENGTH = 15;
const MAX_DATA_ROWS = 3;

function truncate(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_CELL_LENGTH ? trimmed.slice(0, MAX_CELL_LENGTH) + "…" : trimmed;
}

export default function TabularSnippet({ csv, className }: TabularSnippetProps) {
  if (!csv) return null;

  // Strip "Document: [title]\n\n" prefix the indexer embeds in chunk_text
  const stripped = csv.replace(/^Document:[^\n]*\n\n?/, "").trim();

  const lines = stripped.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const headers = lines[0].split(",");
  const dataRows = lines.slice(1, MAX_DATA_ROWS + 1);
  const totalDataRows = lines.length - 1;

  // Single-row with no data: fall back to plain text
  if (dataRows.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground line-clamp-2", className)}>
        {csv}
      </p>
    );
  }

  return (
    <div className={cn("mt-2", className)}>
      <div className="overflow-x-auto rounded-md border border-white/10">
        <table className="w-full text-xs font-mono border-collapse min-w-max">
          <thead>
            <tr className="bg-white/10">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-3 py-1.5 text-left text-muted-foreground font-medium whitespace-nowrap"
                >
                  {truncate(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => {
              const cells = row.split(",");
              const isFading = ri === dataRows.length - 1 && totalDataRows > MAX_DATA_ROWS;
              return (
                <tr
                  key={ri}
                  className={cn(
                    "border-t border-white/5 bg-white/5",
                    isFading && "opacity-40"
                  )}
                >
                  {headers.map((_, ci) => (
                    <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-foreground/80">
                      {truncate(cells[ci] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalDataRows > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          {totalDataRows} row{totalDataRows !== 1 ? "s" : ""} in document
        </p>
      )}
    </div>
  );
}
