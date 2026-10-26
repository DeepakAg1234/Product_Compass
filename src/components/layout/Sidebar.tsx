import { useLocation, useNavigate } from "react-router-dom";
import { Home, Search, Settings, LogOut, Compass, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PMAvatar } from "@/components/ui/pm-avatar";
import { useAuth } from "@/contexts/AuthContext";
import { getUserDisplayName } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const SIDEBAR_COLLAPSED_KEY = "pm-compass-sidebar-collapsed";

const navItems = [
  { icon: Home, label: "Dashboard", path: "/dashboard", shortcut: null },
  { icon: Search, label: "Search", path: "/search", shortcut: "K" },
  { icon: Settings, label: "Settings", path: "/settings", shortcut: null },
];

interface SidebarProps {
  onCommandPalette?: () => void;
}

const AppSidebar = ({ onCommandPalette }: SidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const displayName = getUserDisplayName(user);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch { return false; }
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const handleNavClick = (item: typeof navItems[0]) => {
    if (item.label === "Search" && onCommandPalette) {
      onCommandPalette();
    } else {
      navigate(item.path);
    }
  };

  const isActive = (path: string, label: string) => {
    if (label === "Search") return location.pathname === "/search";
    return location.pathname === path;
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border bg-background transition-all duration-200",
        collapsed ? "w-[60px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className={cn("flex items-center h-16 px-4 border-b border-border", collapsed && "justify-center px-0")}>
        <button onClick={() => navigate("/dashboard")} className="flex items-center gap-2">
          <Compass className="h-6 w-6 text-primary shrink-0" />
          {!collapsed && <span className="font-semibold text-foreground">PM Compass</span>}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map((item) => {
          const active = isActive(item.path, item.label);
          return (
            <button
              key={item.label}
              onClick={() => handleNavClick(item)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
                collapsed && "justify-center px-0"
              )}
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.shortcut && (
                    <kbd className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {"\u2318"}{item.shortcut}
                    </kbd>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 py-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
            collapsed && "justify-center px-0"
          )}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>

      {/* User section */}
      <div className={cn("border-t border-border p-3", collapsed && "flex flex-col items-center")}>
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <PMAvatar name={displayName} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleSignOut}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
};

export default AppSidebar;
export { SIDEBAR_COLLAPSED_KEY };
