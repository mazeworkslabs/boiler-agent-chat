"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Session {
  id: string;
  title: string;
  updatedAt: string;
}

interface AppSidebarProps {
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  user: { email: string; first_name: string; last_name: string } | null;
  onLogout: () => void;
}

export function AppSidebar({
  activeSessionId,
  onSelectSession,
  onNewChat,
  user,
  onLogout,
}: AppSidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
      }
    } catch {
      // ignore
    }
  }, []);

  // Load once on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Refresh session list when activeSessionId changes (new session created)
  const prevActiveRef = useRef(activeSessionId);
  useEffect(() => {
    if (activeSessionId !== prevActiveRef.current) {
      prevActiveRef.current = activeSessionId;
      loadSessions();
    }
  }, [activeSessionId, loadSessions]);

  // Read collapsed state from cookie
  useEffect(() => {
    const match = document.cookie.match(/sidebar_state=(\w+)/);
    if (match) setCollapsed(match[1] === "collapsed");
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sidebar_state=${next ? "collapsed" : "expanded"};max-age=${60 * 60 * 24 * 7};path=/`;
  };

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-12 flex-col items-center border-r border-border bg-card py-4">
        <button
          onClick={toggleCollapse}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted"
          aria-label="Expandera sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button
          onClick={onNewChat}
          className="mt-4 rounded-md p-2 text-muted-foreground hover:bg-muted"
          aria-label="Ny chatt"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/logos/fk-logo-black-horizontal.png"
          alt="Falkenbergs kommun"
          className="logo-light h-9 w-auto"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/logos/fk-logo-white-horizontal.svg"
          alt="Falkenbergs kommun"
          className="logo-dark h-8 w-auto"
        />
        <button
          onClick={toggleCollapse}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          aria-label="Minimera sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* New chat button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Ny chatt
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-3">
        <div className="space-y-1">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors ${
                session.id === activeSessionId
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {session.title}
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-3">
        {user && (
          <p className="mb-2 truncate text-xs text-muted-foreground">
            {user.first_name} {user.last_name}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={toggleTheme}
            className="flex-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Tema
          </button>
          <button
            onClick={onLogout}
            className="flex-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Logga ut
          </button>
        </div>
      </div>
    </div>
  );
}
