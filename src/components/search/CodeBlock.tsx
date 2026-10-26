import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

/** Minimal copy-able code block (shadcn doesn't ship one). Used for the SQL in the answer trace. */
export function CodeBlock({ code, language = "sql", className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className={cn("relative rounded-lg border border-border/60 bg-muted/40", className)}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{language}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}
