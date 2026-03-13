"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ArtifactPanel, type Artifact } from "@/components/artifact/artifact-panel";

export default function Home() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(true);
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (!loading && !user && !redirectedRef.current) {
      redirectedRef.current = true;
      router.push("/login");
    }
  }, [loading, user, router]);

  const handleSelectSession = useCallback((id: string) => {
    setSessionId(id);
    setArtifacts([]);
  }, []);

  const handleNewChat = useCallback(() => {
    setSessionId(null);
    setArtifacts([]);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    router.push("/login");
  }, [logout, router]);

  const handleArtifact = useCallback((artifact: Artifact) => {
    setArtifacts((prev) => [...prev, artifact]);
    setArtifactPanelOpen(true);
  }, []);

  const handleSessionCreated = useCallback((id: string) => {
    setSessionId(id);
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Laddar...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar
        activeSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        user={user}
        onLogout={handleLogout}
      />

      <div className="flex flex-1">
        <div className={`flex-1 ${artifacts.length > 0 && artifactPanelOpen ? "border-r border-border" : ""}`}>
          <ChatPanel
            sessionId={sessionId}
            onSessionCreated={handleSessionCreated}
            onArtifact={handleArtifact}
            artifactCount={artifacts.length}
            artifactPanelOpen={artifactPanelOpen}
            onToggleArtifactPanel={() => setArtifactPanelOpen((v) => !v)}
          />
        </div>

        {artifacts.length > 0 && artifactPanelOpen && (
          <div className="w-1/2">
            <ArtifactPanel
              artifacts={artifacts}
              onClose={() => setArtifactPanelOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
