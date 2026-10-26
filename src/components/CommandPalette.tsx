import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Settings, Home, RefreshCw, Clock } from "lucide-react";

const RECENT_SEARCHES_KEY = "pm-compass-recent-searches";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CommandPalette = ({ open, onOpenChange }: CommandPaletteProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Load recent searches
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {}
  }, [open]);

  const handleSelect = useCallback((searchQuery: string) => {
    // Save to recent searches
    const updated = [searchQuery, ...recentSearches.filter(s => s !== searchQuery)].slice(0, 5);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));

    onOpenChange(false);
    setQuery("");
    navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
  }, [navigate, onOpenChange, recentSearches]);

  const handleAction = useCallback((path: string) => {
    onOpenChange(false);
    setQuery("");
    navigate(path);
  }, [navigate, onOpenChange]);

  // Reset on close
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-[640px] glass-strong rounded-lg border-border/50 shadow-modal top-[20%] translate-y-0 [&>button:last-child]:hidden">
        <Command className="bg-transparent" shouldFilter={false}>
          <div
            className="relative border-b border-border"
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                e.preventDefault();
                handleSelect(query.trim());
              }
            }}
          >
            <CommandInput
              placeholder="Ask about your docs & data, navigate, or take action..."
              value={query}
              onValueChange={setQuery}
              className="h-14 w-full text-base border-0 focus:ring-0 bg-transparent placeholder:text-muted-foreground/60 pr-14"
            />
            <kbd className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded pointer-events-none">
              ESC
            </kbd>
          </div>
          <CommandList className="max-h-[400px] p-2">
            <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
              {query ? `Press Enter to search for "${query}"` : "Start typing to search..."}
            </CommandEmpty>

            {/* Recent Searches */}
            {!query && recentSearches.length > 0 && (
              <CommandGroup heading="Recent Searches">
                {recentSearches.map((search) => (
                  <CommandItem
                    key={search}
                    onSelect={() => handleSelect(search)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer data-[selected='true']:bg-primary/10"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground">{search}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!query && (
              <>
                {recentSearches.length > 0 && <CommandSeparator className="my-1" />}
                <CommandGroup heading="Quick Actions">
                  <CommandItem
                    onSelect={() => handleAction("/dashboard")}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer data-[selected='true']:bg-primary/10"
                  >
                    <Home className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Dashboard</span>
                  </CommandItem>
                  <CommandItem
                    onSelect={() => handleAction("/settings")}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer data-[selected='true']:bg-primary/10"
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Settings</span>
                  </CommandItem>
                  <CommandItem
                    onSelect={() => handleAction("/settings")}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer data-[selected='true']:bg-primary/10"
                  >
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Re-index Documents</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;
