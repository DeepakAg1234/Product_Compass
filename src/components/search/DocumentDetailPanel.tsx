import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { PMButton } from "@/components/ui/pm-button";
import { PMBadge } from "@/components/ui/pm-badge";
import { FileText, Presentation, Sheet as SheetIcon, ExternalLink, Quote, Folder, User, Calendar } from "lucide-react";

interface DocumentResult {
  id: string;
  type: "doc" | "slides" | "sheet";
  title: string;
  matchScore: number;
  lastEdited?: string;
  owner: string;
  snippet: string;
  excerpts?: string[];
  folder?: string;
  url?: string;
}

interface DocumentDetailPanelProps {
  doc: DocumentResult | null;
  open: boolean;
  onClose: () => void;
  query: string;
}

const getFileTypeLabel = (type: string) => {
  switch (type) {
    case "doc": return "Google Docs";
    case "slides": return "Google Slides";
    case "sheet": return "Google Sheets";
    default: return "Document";
  }
};

const getFileIcon = (type: string) => {
  switch (type) {
    case "doc":
      return <FileText className="h-5 w-5 text-primary" />;
    case "slides":
      return <Presentation className="h-5 w-5 text-orange" />;
    case "sheet":
      return <SheetIcon className="h-5 w-5 text-success" />;
    default:
      return <FileText className="h-5 w-5 text-muted-foreground" />;
  }
};

const getScoreBadgeVariant = (score: number): "high" | "medium" | "low" => {
  if (score >= 90) return "high";
  if (score >= 70) return "medium";
  return "low";
};

const DocumentDetailPanel = ({ doc, open, onClose, query }: DocumentDetailPanelProps) => {
  if (!doc) return null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="sm:max-w-md flex flex-col glass-strong border-l border-border">
        <SheetHeader className="text-left pr-8">
          <div className="flex items-center gap-3">
            {getFileIcon(doc.type)}
            <SheetTitle className="text-lg text-foreground">{doc.title}</SheetTitle>
          </div>
          <SheetDescription className="sr-only">Document details</SheetDescription>
        </SheetHeader>

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 items-center mt-2">
          <PMBadge variant={getScoreBadgeVariant(doc.matchScore)}>
            {doc.matchScore}% match
          </PMBadge>
          {doc.owner && (
            <PMBadge variant="default" className="gap-1.5">
              <User className="h-3.5 w-3.5" />{doc.owner}
            </PMBadge>
          )}
          {doc.lastEdited && (
            <PMBadge variant="default" className="gap-1.5">
              <Calendar className="h-3.5 w-3.5" />Last edited {doc.lastEdited}
            </PMBadge>
          )}
          {doc.folder && (
            <PMBadge variant="default" className="gap-1.5">
              <Folder className="h-3.5 w-3.5" />{doc.folder}
            </PMBadge>
          )}
        </div>

        {/* Why this matched */}
        <div className="flex-1 overflow-y-auto mt-6 space-y-3">
          <h4 className="text-sm font-medium text-foreground">Why this matched "{query}"</h4>
          {doc.excerpts && doc.excerpts.length > 0 && (
            <p className="text-xs text-muted-foreground">{doc.excerpts.length} matching passage{doc.excerpts.length !== 1 ? "s" : ""} found</p>
          )}
          {doc.excerpts?.map((excerpt, i) => (
            <div key={i} className="bg-white/5 rounded-md p-3 flex gap-2 border border-white/10">
              <Quote className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-foreground leading-relaxed">{excerpt}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-white/10 mt-4">
          <PMButton
            variant="primary"
            className="w-full gap-2"
            onClick={() => doc.url && window.open(doc.url, "_blank")}
            disabled={!doc.url}
          >
            <ExternalLink className="h-4 w-4" />
            Open in Google Drive
          </PMButton>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default DocumentDetailPanel;
