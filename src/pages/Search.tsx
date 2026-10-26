import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import FeedbackModal from "@/components/search/FeedbackModal";
import DocumentDetailPanel from "@/components/search/DocumentDetailPanel";
import TabularSnippet from "@/components/search/TabularSnippet";
import { PMButton } from "@/components/ui/pm-button";
import { PMBadge } from "@/components/ui/pm-badge";
import { AnswerTrace, type SearchTrace } from "@/components/search/AnswerTrace";
import { StaggerContainer, StaggerItem } from "@/components/ui/stagger-children";
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";
import { ArrowLeft, FileText, Presentation, Sheet, ExternalLink, Sparkles, X, Loader2, AlertTriangle, MessageSquare, Zap, Database, Filter, FileSearch, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";
import { getUserDisplayName } from "@/lib/utils";


interface DocumentResult {
  id: string;
  type: "doc" | "slides" | "sheet";
  contentType: "tabular" | "prose";
  title: string;
  matchScore: number;
  lastEdited?: string;
  owner: string;
  snippet: string;
  excerpts?: string[];
  folder?: string;
  url?: string;
}

function mapDocumentType(docType: string): "doc" | "slides" | "sheet" {
  const lower = (docType || "").toLowerCase();
  if (lower.includes("slide") || lower.includes("presentation")) return "slides";
  if (lower.includes("sheet") || lower.includes("spreadsheet")) return "sheet";
  return "doc";
}

// Step id → human label. Covers both the SQL and vector pipelines; the loader
// renders whichever steps the backend actually streams.
const STEP_LABELS: Record<string, string> = {
  understanding: "Understanding your question",
  routing: "Choosing the best approach",
  generating_sql: "Writing the database query",
  executing: "Running the query on your data",
  matching_feedback: "Matching customer feedback",
  synthesizing: "Composing your answer",
  expanding: "Expanding your query",
  searching: "Searching your documents",
  ranking: "Selecting the best matches",
  composing: "Composing your answer",
};

// Event-driven loader: renders the real steps streamed from the backend. The
// last step is "active" (spinner); earlier ones are done (check).
const PipelineLoader = ({ steps }: { steps: string[] }) => {
  const shown = steps.length ? steps : ["understanding"];
  return (
    <div className="py-8">
      <div className="glass rounded-xl p-6 max-w-lg mx-auto">
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {shown.map((stepId, index) => {
              const isActive = index === shown.length - 1;
              return (
                <motion.div
                  key={stepId}
                  initial={{ opacity: 0, height: 0, y: -5 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="flex items-center gap-3"
                >
                  <div className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-all duration-300 ${
                    isActive ? "bg-primary/20 text-primary" : "bg-success/20 text-success"
                  }`}>
                    {isActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  </div>
                  <p className={`text-sm font-medium transition-colors duration-300 ${
                    isActive ? "text-foreground" : "text-success"
                  }`}>
                    {STEP_LABELS[stepId] ?? stepId}
                  </p>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

interface StreamPayload { answer?: string; sources?: any[]; query?: string; trace?: SearchTrace; step?: string; text?: string; message?: string; }

/** Calls the search function in streaming (SSE) mode and dispatches events. Throws on any failure so the caller can fall back to the buffered call. */
async function streamSearch(
  query: string,
  h: { onStep: (s: string) => void; onToken: (t: string) => void; onResult: (r: StreamPayload) => void },
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("no session token");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/search-documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      let event = "message";
      let dataStr = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (!dataStr) continue;
      let payload: StreamPayload;
      try { payload = JSON.parse(dataStr); } catch { continue; }
      if (event === "step" && payload.step) h.onStep(payload.step);
      else if (event === "token") h.onToken(payload.text ?? "");
      else if (event === "result") h.onResult(payload);
      else if (event === "error") throw new Error(payload.message ?? "stream error");
    }
  }
}

function mapSources(sources: any[]): DocumentResult[] {
  return sources.map((source: any, index: number) => ({
    id: source.document_id || String(index),
    type: mapDocumentType(source.document_type),
    contentType: (source.content_type === "tabular" || mapDocumentType(source.document_type) === "sheet") ? "tabular" : "prose",
    title: source.document_title || "Untitled Document",
    matchScore: Math.round((source.similarity || 0) * 100),
    owner: source.document_owner || "",
    snippet: source.snippet || source.chunk_text || "",
    excerpts: source.chunk_text ? [source.chunk_text] : [],
    url: source.document_url,
  }));
}

const Search = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const { user } = useAuth();

  const [results, setResults] = useState<DocumentResult[]>([]);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiTrace, setAiTrace] = useState<SearchTrace | null>(null);
  const [streamSteps, setStreamSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showSummary, setShowSummary] = useState(true);
  const [summarizingDocId, setSummarizingDocId] = useState<string | null>(null);
  const [docSummaries, setDocSummaries] = useState<Record<string, string>>({});
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentResult | null>(null);

  // Fetch search results from edge function
  useEffect(() => {
    if (!query) return;

    const fetchResults = async () => {
      setLoading(true);
      setError(null);
      setResults([]);
      setAiAnswer("");
      setAiTrace(null);
      setStreamSteps([]);
      setShowSummary(true);

      try {
        // Primary: streaming (SSE) — real pipeline steps + answer tokens.
        let acc = "";
        let revealed = false;
        await streamSearch(query, {
          onStep: (s) => setStreamSteps((prev) => (prev.includes(s) ? prev : [...prev, s])),
          onToken: (t) => {
            acc += t;
            if (!revealed) { revealed = true; setLoading(false); } // swap loader → growing answer
            setAiAnswer(acc);
          },
          onResult: (r) => {
            if (r.answer) setAiAnswer(r.answer);
            setAiTrace(r.trace ?? null);
            if (Array.isArray(r.sources)) setResults(mapSources(r.sources));
            setLoading(false);
          },
        });
      } catch (streamErr) {
        // Fallback: buffered (non-streaming) call if streaming is unavailable.
        console.warn("Streaming failed, falling back to buffered search:", streamErr);
        try {
          const { data, error: fnError } = await supabase.functions.invoke("search-documents", { body: { query } });
          if (fnError) throw fnError;
          if (data?.answer) setAiAnswer(data.answer);
          setAiTrace(data?.trace ?? null);
          if (data?.sources && Array.isArray(data.sources)) setResults(mapSources(data.sources));
        } catch (err) {
          console.error("Search error:", err);
          setError("Failed to search documents. Please try again.");
          toast.error("Search failed. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [query]);

  const getFileIcon = (type: string) => {
    switch (type) {
      case "doc":
        return <FileText className="h-5 w-5 text-primary" />;
      case "slides":
        return <Presentation className="h-5 w-5 text-orange" />;
      case "sheet":
        return <Sheet className="h-5 w-5 text-success" />;
      default:
        return <FileText className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getScoreBadgeVariant = (score: number): "high" | "medium" | "low" => {
    if (score >= 90) return "high";
    if (score >= 70) return "medium";
    return "low";
  };

  const handleSummarizeDoc = async (doc: DocumentResult) => {
    setSummarizingDocId(doc.id);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("search-documents", {
        body: { query: `Summarize the key points of ${doc.title}` },
      });
      if (fnError) throw fnError;
      if (data?.answer) {
        setDocSummaries((prev) => ({ ...prev, [doc.id]: data.answer }));
      }
    } catch (err) {
      console.error("Summarize error:", err);
      toast.error("Failed to summarize document.");
    } finally {
      setSummarizingDocId(null);
    }
  };

  return (
    <div className="max-w-[1000px] mx-auto px-6 lg:px-8 py-8">
      {/* Back Button */}
      <button
        onClick={() => navigate("/dashboard")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-page-title text-foreground mb-1">
          Results for: "{query}"
        </h1>
        {!loading && !error && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {aiTrace && aiTrace.mode !== "vector"
                ? "Answered directly from your data"
                : `Found ${results.length} document${results.length !== 1 ? "s" : ""} · Ranked by relevance`}
            </p>
            {aiAnswer && (
              <PMButton variant="glass" size="sm" onClick={() => setShowSummary(!showSummary)} className="gap-1.5">
                <Sparkles className="h-3 w-3" />
                {showSummary ? "Hide AI Summary" : "Show AI Summary"}
              </PMButton>
            )}
          </div>
        )}
      </div>

      {/* Loading State — Pipeline Steps */}
      {loading && <PipelineLoader steps={streamSteps} />}

      {/* Error State */}
      {error && !loading && (
        <div className="flex items-center gap-3 p-4 rounded-lg glass mb-6" style={{ borderColor: "hsl(0 84% 60% / 0.3)" }}>
          <AlertTriangle className="h-5 w-5 text-error shrink-0" />
          <p className="text-sm text-foreground">{error}</p>
        </div>
      )}

      {/* Empty State — only when there's genuinely no answer (vector path found nothing) */}
      {!loading && !error && results.length === 0 && query && !aiAnswer && (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-2">No documents matched your query.</p>
          <p className="text-sm text-muted-foreground">Try a different search term or make sure your documents are indexed.</p>
        </div>
      )}

      {/* AI Summary */}
      {!loading && !error && (
        <AnimatePresence>
          {showSummary && aiAnswer && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <div
                className="rounded-xl p-[1px]"
                style={{
                  background: "linear-gradient(135deg, hsl(217 91% 60% / 0.4), hsl(258 90% 66% / 0.4))",
                }}
              >
                <div className="rounded-xl p-5 bg-background/95 backdrop-blur-xl">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-primary/20 to-purple/20">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-semibold text-foreground">AI Summary</span>
                    {aiTrace && aiTrace.mode !== "vector" ? (
                      <PMBadge variant="success" className="text-[10px] ml-1">
                        computed from your data
                      </PMBadge>
                    ) : (
                      <PMBadge variant="info" className="text-[10px] ml-1">
                        {results.length} source{results.length !== 1 ? "s" : ""}
                      </PMBadge>
                    )}
                  </div>
                  <div className="text-sm text-foreground leading-relaxed prose prose-invert prose-sm max-w-none prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-a:text-primary">
                    <ReactMarkdown>{aiAnswer}</ReactMarkdown>
                  </div>
                  {aiTrace && <AnswerTrace trace={aiTrace} />}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Document Results */}
      {!loading && !error && results.length > 0 && (
        <StaggerContainer className="space-y-3">
          {results.map((doc) => (
            <StaggerItem key={doc.id}>
              <div className="glass rounded-lg p-4 transition-all duration-200 hover:shadow-glow hover:scale-[1.005] group">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3 flex-1">
                    <div className="mt-0.5 p-1.5 rounded-md bg-white/5 group-hover:bg-white/10 transition-colors">
                      {getFileIcon(doc.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-card-title text-foreground group-hover:text-primary cursor-pointer transition-colors">
                        {doc.title}
                      </h3>
                      {(doc.lastEdited || doc.owner) && (
                        <p className="text-small text-muted-foreground mt-1">
                          {doc.lastEdited && `Last edited: ${doc.lastEdited}`}
                          {doc.lastEdited && doc.owner && " · "}
                          {doc.owner && `Owner: ${doc.owner}`}
                        </p>
                      )}
                      {doc.contentType === "tabular" ? (
                        <TabularSnippet csv={doc.snippet} className="mt-2" />
                      ) : (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {doc.snippet}
                        </p>
                      )}
                      {docSummaries[doc.id] && (
                        <div className="mt-2 p-3 glass rounded-md text-sm text-foreground border-l-2 border-l-purple">
                          <div className="flex items-center gap-1.5 mb-1 text-xs text-purple font-medium">
                            <Sparkles className="h-3 w-3" />
                            AI Summary
                          </div>
                          {docSummaries[doc.id]}
                        </div>
                      )}
                      <div className="flex gap-2 mt-3">
                        {doc.url && (
                          <PMButton
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => window.open(doc.url, "_blank")}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open in Drive
                          </PMButton>
                        )}
                        <PMButton
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSummarizeDoc(doc)}
                          disabled={summarizingDocId === doc.id}
                          className="gap-1.5"
                        >
                          {summarizingDocId === doc.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          {summarizingDocId === doc.id ? "Summarizing..." : "Summarize"}
                        </PMButton>
                        <PMButton variant="ghost" size="sm" onClick={() => setSelectedDoc(doc)}>
                          View Details
                        </PMButton>
                      </div>
                    </div>
                  </div>
                  <PMBadge variant={getScoreBadgeVariant(doc.matchScore)}>
                    {doc.matchScore}% match
                  </PMBadge>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}

      {/* Feedback Link */}
      {!loading && (
        <div className="pt-6 text-center">
          <button
            onClick={() => setFeedbackOpen(true)}
            className="text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4"
          >
            Can't find what you need?
          </button>
        </div>
      )}

      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} query={query} />
      <DocumentDetailPanel
        doc={selectedDoc}
        open={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        query={query}
      />
    </div>
  );
};

export default Search;
