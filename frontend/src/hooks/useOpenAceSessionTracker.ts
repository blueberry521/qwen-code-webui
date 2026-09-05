/**
 * Hook for tracking session end with Open-ACE
 *
 * When running in integrated mode (inside Open-ACE iframe),
 * this hook notifies Open-ACE about session end for statistics tracking.
 *
 * Note: Session registration is now handled by the backend before the first
 * request, ensuring proper session attribution from the first turn (issue #222).
 * This hook only handles session end notification.
 */

import { useEffect, useRef, useCallback } from "react";
import {
  isIntegratedMode,
  getOpenAceSessionApi,
} from "../api/openace";

interface SessionTracker {
  sessionId: string | null;
  projectPath: string | null;
}

export function useOpenAceSessionTracker(
  currentSessionId: string | null,
  projectPath: string | null,
  isActive: boolean = true
) {
  const trackerRef = useRef<SessionTracker>({
    sessionId: null,
    projectPath: null,
  });

  const integrated = isIntegratedMode();

  // End tracking when session ends
  const endTracking = useCallback(async () => {
    if (!integrated || !trackerRef.current.sessionId) return;

    const sessionId = trackerRef.current.sessionId;

    try {
      await fetch(getOpenAceSessionApi(sessionId, "complete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      console.log("[Open-ACE] Ended tracking session:", sessionId);
    } catch (error) {
      console.error("[Open-ACE] Failed to end session tracking:", error);
    } finally {
      trackerRef.current = {
        sessionId: null,
        projectPath: null,
      };
    }
  }, [integrated]);

  // Track session ID changes for end notification
  useEffect(() => {
    if (!isActive || !integrated) return;

    // Update tracked session ID
    if (currentSessionId && projectPath) {
      trackerRef.current = {
        sessionId: currentSessionId,
        projectPath,
      };
    }

    // Cleanup on unmount or when session becomes inactive
    return () => {
      if (trackerRef.current.sessionId) {
        // Use navigator.sendBeacon for reliable cleanup on page unload
        const sessionId = trackerRef.current.sessionId;
        const url = getOpenAceSessionApi(sessionId, "complete");

        if (navigator.sendBeacon) {
          navigator.sendBeacon(url);
        }
      }
    };
  }, [currentSessionId, projectPath, isActive, integrated]);

  // Handle page unload
  useEffect(() => {
    if (!integrated) return;

    const handleBeforeUnload = () => {
      if (trackerRef.current.sessionId) {
        const sessionId = trackerRef.current.sessionId;
        const url = getOpenAceSessionApi(sessionId, "complete");
        navigator.sendBeacon(url);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [integrated]);

  return {
    endTracking,
    isTracking: !!trackerRef.current.sessionId,
    trackedSessionId: trackerRef.current.sessionId,
  };
}