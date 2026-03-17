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
  const [editingArtifact, setEditingArtifact] = useState<Artifact | null>(null);
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
    setEditingArtifact(null);
  }, []);

  const handleNewChat = useCallback(() => {
    setSessionId(null);
    setArtifacts([]);
    setEditingArtifact(null);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    router.push("/login");
  }, [logout, router]);

  const handleArtifact = useCallback((artifact: Artifact) => {
    setArtifacts((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === artifact.id);
      if (existingIndex === -1) {
        return [...prev, artifact];
      }

      const next = [...prev];
      next[existingIndex] = artifact;
      return next;
    });
    setArtifactPanelOpen(true);
  }, []);

  const handleSessionCreated = useCallback((id: string) => {
    setSessionId(id);
  }, []);

  const handleReplaceArtifacts = useCallback((nextArtifacts: Artifact[]) => {
    setArtifacts(nextArtifacts);
    setEditingArtifact((current) => {
      if (!current) return null;
      return nextArtifacts.find((artifact) => artifact.id === current.id) || null;
    });
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

      <div className="flex flex-1 min-w-0 overflow-hidden">
        <div className={`flex-1 min-w-0 ${artifacts.length > 0 && artifactPanelOpen ? "border-r border-border" : ""}`}>
          <ChatPanel
            sessionId={sessionId}
            onSessionCreated={handleSessionCreated}
            onArtifact={handleArtifact}
            onReplaceArtifacts={handleReplaceArtifacts}
            artifactCount={artifacts.length}
            artifactPanelOpen={artifactPanelOpen}
            onToggleArtifactPanel={() => setArtifactPanelOpen((v) => !v)}
            editingArtifact={editingArtifact}
            onClearEditingArtifact={() => setEditingArtifact(null)}
          />
        </div>

        {artifacts.length > 0 && artifactPanelOpen && (
          <div className="w-[45%] shrink-0 min-w-[320px] max-w-[640px]">
            <ArtifactPanel
              key={artifacts[artifacts.length - 1]?.id || "artifact-panel"}
              artifacts={artifacts}
              onClose={() => setArtifactPanelOpen(false)}
              onEdit={(artifact) => setEditingArtifact(artifact)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
