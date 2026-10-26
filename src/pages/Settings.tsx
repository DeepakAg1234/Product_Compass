import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PMButton } from "@/components/ui/pm-button";
import { PMBadge } from "@/components/ui/pm-badge";
import { PMModal, PMModalHeader, PMModalTitle, PMModalDescription, PMModalContent, PMModalFooter } from "@/components/ui/pm-modal";
import { PMInput } from "@/components/ui/pm-input";
import { StaggerContainer, StaggerItem } from "@/components/ui/stagger-children";
import { ArrowLeft, Check, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getUserDisplayName } from "@/lib/utils";
import { format } from "date-fns";

const Settings = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [disconnectModal, setDisconnectModal] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [hasGoogleTokens, setHasGoogleTokens] = useState(false);
  const [lastIndexedAt, setLastIndexedAt] = useState<string | null>(null);

  // Chunking strategy
  const [chunkPreset, setChunkPreset] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pm-compass-chunk-settings") || "{}");
      return saved.chunkPreset || "balanced";
    } catch { return "balanced"; }
  });
  const [customChunkSize, setCustomChunkSize] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pm-compass-chunk-settings") || "{}");
      return saved.customChunkSize || 1600;
    } catch { return 1600; }
  });
  const [customChunkOverlap, setCustomChunkOverlap] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pm-compass-chunk-settings") || "{}");
      return saved.customChunkOverlap || 400;
    } catch { return 400; }
  });

  useEffect(() => {
    localStorage.setItem("pm-compass-chunk-settings", JSON.stringify({
      chunkPreset,
      customChunkSize,
      customChunkOverlap,
    }));
  }, [chunkPreset, customChunkSize, customChunkOverlap]);

  const displayName = getUserDisplayName(user);
  const userEmail = user?.email || "unknown";

  useEffect(() => {
    if (!user) return;
    const fetchStats = async () => {
      const { count } = await supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true });
      setDocCount(count ?? 0);

      const { data: distinctDocs } = await supabase
        .from("document_chunks")
        .select("document_id")
        .eq("user_id", user.id);
      if (distinctDocs) {
        const unique = new Set(distinctDocs.map((d: any) => d.document_id));
        setFileCount(unique.size);
      }

      const { data: latestChunk } = await supabase
        .from("document_chunks")
        .select("created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (latestChunk && latestChunk.length > 0) {
        setLastIndexedAt(latestChunk[0].created_at);
      }

      const { count: tokenCount } = await supabase
        .from("oauth_tokens")
        .select("id", { count: "exact", head: true })
        .eq("provider", "google");
      setHasGoogleTokens((tokenCount ?? 0) > 0);
    };
    fetchStats();
  }, [user]);

  const connectedServices = [
    { name: "Google Drive", status: hasGoogleTokens ? "Connected" : "Not connected", email: userEmail },
    { name: "Google Docs", status: hasGoogleTokens ? "Connected" : "Not connected" },
  ];

  const getChunkParams = () => {
    switch (chunkPreset) {
      case "precise": return { chunk_size: 800, chunk_overlap: 200 };
      case "balanced": return { chunk_size: 1600, chunk_overlap: 400 };
      case "context-rich": return { chunk_size: 3200, chunk_overlap: 800 };
      case "custom": return { chunk_size: customChunkSize, chunk_overlap: customChunkOverlap };
      default: return {};
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      let offset = 0;
      let remaining = 1;
      let total = 0;
      while (remaining > 0) {
        const { data: indexData } = await supabase.functions.invoke("index-documents", {
          body: { offset, ...getChunkParams() },
        });
        if (indexData?.total) {
          total = indexData.total;
          setFileCount(total);
        }
        remaining = indexData?.remaining ?? 0;
        offset += indexData?.processed ?? 0;
      }
      const { count } = await supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true });
      setDocCount(count ?? 0);
      const { data: latestChunk } = await supabase
        .from("document_chunks")
        .select("created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (latestChunk && latestChunk.length > 0) {
        setLastIndexedAt(latestChunk[0].created_at);
      }
      toast.success("Re-indexed successfully!");
    } catch {
      toast.error("Failed to re-index.");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (service: string) => {
    if (user?.id) {
      await supabase.from("oauth_tokens").delete().eq("user_id", user.id).eq("provider", "google");
      setHasGoogleTokens(false);
    }
    setDisconnectModal(null);
    toast.success(`${service} disconnected`);
  };

  const handleClearHistory = () => {
    localStorage.removeItem("pm-compass-recent-searches");
    toast.success("Search history cleared");
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE" || !user?.id || deleting) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account");
      if (error || data?.error) {
        console.error("Delete account error:", error ?? data?.error);
        toast.error("Failed to delete account. Please try again.");
        return;
      }
      await signOut();
      setDeleteModal(false);
      toast.success("Account deleted");
      navigate("/");
    } catch (err) {
      console.error("Delete account error:", err);
      toast.error("Failed to delete account. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="max-w-[600px] mx-auto px-6 lg:px-8 py-8">
      <StaggerContainer>
        {/* Header */}
        <StaggerItem>
          <div className="flex items-center justify-between mb-8">
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </button>
            <h1 className="text-section-title text-foreground">Settings</h1>
          </div>
        </StaggerItem>

        {/* Connected Services */}
        <StaggerItem>
          <section className="mb-8">
            <h2 className="text-caption text-muted-foreground mb-4">CONNECTED SERVICES</h2>
            <div className="space-y-3">
              {connectedServices.map((service) => (
                <div
                  key={service.name}
                  className="flex items-center justify-between p-4 glass rounded-lg"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{service.name}</p>
                    {service.email && (
                      <p className="text-small text-muted-foreground">Connected as: {service.email}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${hasGoogleTokens ? "bg-success" : "bg-muted-foreground"}`} />
                      <span className={`text-small ${hasGoogleTokens ? "text-success" : "text-muted-foreground"}`}>
                        {service.status}
                      </span>
                    </div>
                  </div>
                  {hasGoogleTokens && (
                    <PMButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setDisconnectModal(service.name)}
                    >
                      Disconnect
                    </PMButton>
                  )}
                </div>
              ))}
            </div>
          </section>
        </StaggerItem>

        <hr className="border-border mb-8" />

        {/* Indexing Status */}
        <StaggerItem>
          <section className="mb-8">
            <h2 className="text-caption text-muted-foreground mb-4">INDEXING STATUS</h2>
            <div className="p-4 glass rounded-lg space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success" />
                  <span className="text-sm text-foreground">
                    {docCount !== null ? `${docCount} document chunks indexed` : "Loading..."}
                  </span>
                </div>
                {fileCount !== null && fileCount > 0 && (
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-success" />
                    <span className="text-sm text-foreground">
                      {fileCount} document{fileCount !== 1 ? "s" : ""} parsed
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  Last indexed: {lastIndexedAt
                    ? format(new Date(lastIndexedAt), "MMM d, yyyy 'at' h:mm a")
                    : "Never"}
                </span>
              </div>

              {/* Chunking Strategy */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <label className="text-sm font-medium text-foreground">Chunking Strategy</label>
                <select
                  value={chunkPreset}
                  onChange={(e) => setChunkPreset(e.target.value)}
                  className="w-full rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-foreground"
                >
                  <option value="precise">Precise (800 / 200 overlap)</option>
                  <option value="balanced">Balanced (1600 / 400 overlap)</option>
                  <option value="context-rich">Context-rich (3200 / 800 overlap)</option>
                  <option value="custom">Custom</option>
                </select>
                {chunkPreset === "custom" && (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground">Chunk Size (chars)</label>
                      <PMInput
                        type="number"
                        value={customChunkSize}
                        onChange={(e) => setCustomChunkSize(Number(e.target.value))}
                        min={200}
                        max={10000}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground">Overlap (chars)</label>
                      <PMInput
                        type="number"
                        value={customChunkOverlap}
                        onChange={(e) => setCustomChunkOverlap(Number(e.target.value))}
                        min={0}
                        max={5000}
                      />
                    </div>
                  </div>
                )}
              </div>

              <PMButton variant="primary" size="sm" onClick={handleSync} loading={syncing}>
                Re-index Now
              </PMButton>
            </div>
          </section>
        </StaggerItem>

        {/* Usage This Month */}
        <StaggerItem>
          <section className="mb-8">
            <h2 className="text-caption text-muted-foreground mb-4">USAGE THIS MONTH</h2>
            <div className="p-4 glass rounded-lg space-y-3">
              <PMBadge variant="success">Beta — Unlimited access</PMBadge>
            </div>
          </section>
        </StaggerItem>

        <hr className="border-border mb-8" />

        {/* Account */}
        <StaggerItem>
          <section className="mb-8">
            <h2 className="text-caption text-muted-foreground mb-4">ACCOUNT</h2>
            <div className="p-4 glass rounded-lg space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Email</span>
                <span className="text-sm text-foreground">{userEmail}</span>
              </div>
            </div>
          </section>
        </StaggerItem>

        <hr className="border-border mb-8" />

        {/* Data & Privacy */}
        <StaggerItem>
          <section className="mb-8">
            <h2 className="text-caption text-muted-foreground mb-4">DATA & PRIVACY</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 glass rounded-lg">
                <span className="text-sm text-foreground">Clear search history</span>
                <PMButton variant="secondary" size="sm" onClick={handleClearHistory}>
                  Clear
                </PMButton>
              </div>
              <div className="flex items-center justify-between p-4 glass rounded-lg border-error/20 hover:shadow-[0_0_20px_hsl(0_84%_60%/0.1)] transition-shadow">
                <span className="text-sm text-foreground">Delete account and all data</span>
                <PMButton variant="danger" size="sm" onClick={() => setDeleteModal(true)}>
                  Delete Account
                </PMButton>
              </div>
            </div>
          </section>
        </StaggerItem>

        <hr className="border-border mb-8" />

        {/* Sign Out */}
        <StaggerItem>
          <PMButton variant="secondary" className="w-full" onClick={handleSignOut}>
            Sign Out
          </PMButton>
        </StaggerItem>
      </StaggerContainer>

      {/* Disconnect Modal */}
      <PMModal open={!!disconnectModal} onClose={() => setDisconnectModal(null)}>
        <PMModalHeader>
          <PMModalTitle>Disconnect {disconnectModal}?</PMModalTitle>
          <PMModalDescription>
            You will no longer be able to search files from this service.
          </PMModalDescription>
        </PMModalHeader>
        <PMModalFooter>
          <PMButton variant="secondary" onClick={() => setDisconnectModal(null)}>
            Cancel
          </PMButton>
          <PMButton variant="danger" onClick={() => handleDisconnect(disconnectModal || "")}>
            Disconnect
          </PMButton>
        </PMModalFooter>
      </PMModal>

      {/* Delete Account Modal */}
      <PMModal open={deleteModal} onClose={() => setDeleteModal(false)}>
        <PMModalHeader>
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-error" />
            </div>
          </div>
          <PMModalTitle>Delete your account?</PMModalTitle>
          <PMModalDescription>
            This action cannot be undone. All your data will be permanently deleted.
          </PMModalDescription>
        </PMModalHeader>
        <PMModalContent>
          <p className="text-sm text-muted-foreground mb-2">
            Type <span className="font-mono text-foreground">DELETE</span> to confirm:
          </p>
          <PMInput
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="DELETE"
          />
        </PMModalContent>
        <PMModalFooter>
          <PMButton variant="secondary" onClick={() => setDeleteModal(false)}>
            Cancel
          </PMButton>
          <PMButton
            variant="danger"
            onClick={handleDeleteAccount}
            disabled={deleteConfirm !== "DELETE" || deleting}
          >
            {deleting ? "Deleting…" : "Delete Account"}
          </PMButton>
        </PMModalFooter>
      </PMModal>
    </div>
  );
};

export default Settings;
