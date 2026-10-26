import { useState, useEffect, useCallback } from "react";
import AppSidebar, { SIDEBAR_COLLAPSED_KEY } from "@/components/layout/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import PageTransition from "@/components/layout/PageTransition";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch { return false; }
  });

  // Listen for sidebar collapse changes
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const val = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
        if (val !== sidebarCollapsed) setSidebarCollapsed(val);
      } catch {}
    }, 200);
    return () => clearInterval(interval);
  }, [sidebarCollapsed]);

  // Global Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openCommandPalette = useCallback(() => setCommandOpen(true), []);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile menu button */}
      {isMobile && (
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="fixed top-4 left-4 z-50 p-2 rounded-md bg-card border border-border text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Sidebar — hidden on mobile unless open */}
      {(!isMobile || mobileMenuOpen) && (
        <>
          {isMobile && mobileMenuOpen && (
            <div
              className="fixed inset-0 z-20 bg-background/80 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
          )}
          <AppSidebar onCommandPalette={openCommandPalette} />
        </>
      )}

      {/* Main content area */}
      <main
        className={cn(
          "min-h-screen transition-all duration-200",
          isMobile ? "pl-0" : sidebarCollapsed ? "pl-[60px]" : "pl-[240px]"
        )}
      >
        <PageTransition>
          {children}
        </PageTransition>
      </main>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
};

export default AppLayout;
