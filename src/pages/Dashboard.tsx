import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PMCard, PMCardHeader, PMCardTitle, PMCardContent, PMCardFooter } from "@/components/ui/pm-card";
import { StaggerContainer, StaggerItem } from "@/components/ui/stagger-children";
import { Calendar, Clock, Loader2, CheckCircle2, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getUserDisplayName } from "@/lib/utils";

const RECENT_SEARCHES_KEY = "pm-compass-recent-searches";
const INDEXED_FLAG_KEY = "pm-compass-indexed";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [greeting, setGreeting] = useState("Good morning");

  // Google API token state
  const [hasGoogleTokens, setHasGoogleTokens] = useState<boolean | null>(null);

  // Indexing state
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{ processed: number; total: number } | null>(null);
  const [indexComplete, setIndexComplete] = useState(false);

  // Recent searches from localStorage
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const displayName = getUserDisplayName(user);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) setGreeting("Good morning");
    else if (hour >= 12 && hour < 17) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, []);

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {}
  }, []);

  // Check if user has Google API tokens (with retry for post-OAuth race condition)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const checkTokens = async (attempt = 0) => {
      const { count } = await supabase
        .from("oauth_tokens")
        .select("id", { count: "exact", head: true })
        .eq("provider", "google");

      if (cancelled) return;

      if ((count ?? 0) > 0) {
        setHasGoogleTokens(true);
      } else if (attempt < 3) {
        // Session may not be ready yet after OAuth redirect — retry
        setTimeout(() => checkTokens(attempt + 1), 1000);
      } else {
        setHasGoogleTokens(false);
      }
    };

    checkTokens();
    return () => { cancelled = true; };
  }, [user]);

  // Document indexing
  const runIndexing = useCallback(async (offset = 0) => {
    setIndexing(true);
    try {
      const { data, error } = await supabase.functions.invoke("index-documents", {
        body: { offset },
      });
      if (error) throw error;

      const totalProcessed = offset + (data.processed || 0);
      setIndexProgress({ processed: totalProcessed, total: data.total || 0 });

      if (data.status === "in_progress" && data.remaining > 0) {
        await runIndexing(totalProcessed);
      } else {
        setIndexing(false);
        setIndexComplete(true);
        localStorage.setItem(INDEXED_FLAG_KEY, "true");
        setTimeout(() => setIndexComplete(false), 4000);
      }
    } catch (err: any) {
      console.error("Indexing error:", err);
      setIndexing(false);
      toast.error("Failed to index documents. Please try again from Settings.");
    }
  }, []);

  useEffect(() => {
    if (!user || !hasGoogleTokens) return;
    const alreadyIndexed = localStorage.getItem(INDEXED_FLAG_KEY);
    if (alreadyIndexed) return;

    const checkAndIndex = async () => {
      const { count } = await supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true });

      if (count === 0) {
        runIndexing();
      } else {
        localStorage.setItem(INDEXED_FLAG_KEY, "true");
      }
    };
    checkAndIndex();
  }, [user, hasGoogleTokens, runIndexing]);

  const handleSearch = (query: string) => {
    const updated = [query, ...recentSearches.filter((s) => s !== query)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const clearSearchHistory = () => {
    setRecentSearches([]);
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  };

  return (
    <div className="max-w-[1000px] mx-auto px-6 lg:px-8 py-12">
      <StaggerContainer>
        {/* Greeting */}
        <StaggerItem>
          <div className="text-center mb-8">
            <h1 className="text-page-title text-foreground mb-2">{greeting}, {displayName}</h1>
            <p className="text-body text-muted-foreground">Here's what's on your radar today</p>
          </div>
        </StaggerItem>

        {/* Google Connect Banner */}
        {hasGoogleTokens === false && (
          <StaggerItem>
            <div className="mb-6 flex items-center justify-between rounded-lg glass px-4 py-3">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="text-sm text-foreground">
                  Google tokens not detected. Try signing out and signing back in to reconnect.
                </span>
              </div>
            </div>
          </StaggerItem>
        )}

        {/* Indexing Status Banner */}
        <AnimatePresence>
          {indexing && indexProgress && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 flex items-center gap-3 rounded-lg glass px-4 py-3"
            >
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-foreground">
                Indexing your documents... ({indexProgress.processed} of {indexProgress.total} processed)
              </span>
            </motion.div>
          )}
          {indexComplete && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 flex items-center gap-3 rounded-lg glass px-4 py-3"
            >
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm text-foreground">
                {indexProgress?.total || 0} documents indexed
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search Trigger — opens command palette */}
        <StaggerItem>
          <button
            onClick={() => {
              // Dispatch Cmd+K to open command palette
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
            }}
            className="w-full mb-12 h-14 rounded-lg glass flex items-center gap-3 px-5 text-left transition-all duration-200 hover:shadow-glow group"
          >
            <Search className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="text-base text-muted-foreground flex-1">Ask about your documents and data...</span>
            <kbd className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              <span>{"\u2318"}</span>
              <span>K</span>
            </kbd>
          </button>
        </StaggerItem>

        {/* Widgets */}
        <div className="max-w-[560px] mx-auto">
          {/* Recent Searches */}
          <StaggerItem className="h-full">
            <PMCard hoverable className="flex flex-col h-full">
              <PMCardHeader>
                <Clock className="h-4 w-4 text-muted-foreground" />
                <PMCardTitle>Recent Searches</PMCardTitle>
              </PMCardHeader>
              <PMCardContent className="flex-1">
                {recentSearches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                      <Search className="h-6 w-6 text-primary/60" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No searches yet</p>
                    <p className="text-xs text-muted-foreground">Try asking "Find my latest PRD" or press <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">{"\u2318"}K</kbd></p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentSearches.map((search) => (
                      <button
                        key={search}
                        onClick={() => handleSearch(search)}
                        className="w-full text-left p-2.5 -mx-2 rounded-md hover:bg-white/5 transition-colors group flex items-center gap-2"
                      >
                        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground">"{search}"</span>
                      </button>
                    ))}
                  </div>
                )}
              </PMCardContent>
              <PMCardFooter>
                {recentSearches.length > 0 && (
                  <button
                    onClick={clearSearchHistory}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear history
                  </button>
                )}
              </PMCardFooter>
            </PMCard>
          </StaggerItem>
        </div>
      </StaggerContainer>
    </div>
  );
};

export default Dashboard;
