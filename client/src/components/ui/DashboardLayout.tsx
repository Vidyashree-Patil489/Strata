import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  BarChart2,
  FolderGit2,
  Search,
  Settings,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Share2,
} from "lucide-react";
import { StrataMark } from "./StrataMark";

const NAV_ITEMS = [
  { label: "Health",          icon: BarChart2,  path: "/dashboard" },
  { label: "Knowledge graph", icon: Share2,     path: "/dashboard/graph" },
  { label: "Forensics",       icon: Search,     path: "/dashboard/forensics" },
  { label: "Repos",           icon: FolderGit2, path: "/dashboard/repos" },
  { label: "Settings",        icon: Settings,   path: "/dashboard/settings" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [dropdownOpen]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen z-50 lg:z-auto w-60 bg-sidebar border-r border-border flex flex-col transition-transform duration-150 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-border">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2.5 -ml-1 px-1 rounded-md hover:bg-muted transition-colors"
          >
            <StrataMark size={22} />
            <span className="text-[15px] font-semibold tracking-tight">
              Strata
            </span>
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-muted-foreground hover:text-foreground rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto">
          <p className="px-2 mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Workspace
          </p>
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 mb-0.5 rounded-md text-[13px] transition-colors ${
                  active
                    ? "bg-card text-foreground border border-border font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                }`}
              >
                <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-2 py-3 border-t border-border">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-card transition-colors"
            >
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  className="w-6 h-6 rounded-full border border-border"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-foreground text-background flex items-center justify-center">
                  <span className="text-[10px] font-semibold">
                    {user?.username?.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[12px] font-medium truncate leading-tight">
                  {user?.username}
                </p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">
                  {user?.email || "—"}
                </p>
              </div>
              <ChevronDown
                className={`w-3 h-3 text-muted-foreground flex-shrink-0 transition-transform ${
                  dropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {dropdownOpen && (
              <div className="absolute bottom-full mb-1 left-0 right-0 bg-card border border-border rounded-md py-1 z-50">
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    navigate("/dashboard/settings");
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-muted transition-colors"
                >
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                  Settings
                </button>
                <button
                  onClick={async () => {
                    setDropdownOpen(false);
                    await logout();
                    navigate("/login");
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-destructive hover:bg-muted transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border px-4 h-12 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-muted-foreground hover:text-foreground rounded-md"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <StrataMark size={18} />
            <span className="text-[13px] font-semibold">Strata</span>
          </div>
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="w-6 h-6 rounded-full border border-border"
            />
          ) : (
            <div className="w-6 h-6" />
          )}
        </div>

        <div className="px-6 sm:px-10 lg:px-12 py-8 lg:py-10 max-w-[1200px]">
          {children}
        </div>
      </main>
    </div>
  );
}
