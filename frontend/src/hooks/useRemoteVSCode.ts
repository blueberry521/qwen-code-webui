import { useState, useCallback, useEffect, useRef } from "react";
import {
  startRemoteVSCode,
  stopRemoteVSCode,
  getRemoteVSCodeStatus,
} from "../api/openace";

interface RemoteVSCodeState {
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  url: string | null;
  start: (machineId: string, workingDirectory: string) => Promise<void>;
  stop: (machineId: string) => Promise<void>;
}

const STATUS_POLL_INTERVAL = 2000;
const STATUS_POLL_TIMEOUT = 60000; // 60s max wait for code-server to start

export function useRemoteVSCode(): RemoteVSCodeState {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const vscodeIdRef = useRef<string | null>(null);
  // Track whether the component is still mounted to avoid setState after unmount
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const start = useCallback(async (machineId: string, workingDirectory: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await startRemoteVSCode(machineId, workingDirectory);

      if (!result.success || !result.vscode_id) {
        throw new Error(result.error || "Failed to start VSCode");
      }

      vscodeIdRef.current = result.vscode_id;

      // Poll status until code-server is ready
      const startTime = Date.now();
      while (Date.now() - startTime < STATUS_POLL_TIMEOUT) {
        if (!mountedRef.current) return;

        const status = await getRemoteVSCodeStatus(result.vscode_id!);

        if (!mountedRef.current) return;

        if (status.status === "running" && status.url) {
          // Build the full URL with the folder query param
          const separator = status.url.includes("?") ? "&" : "?";
          const fullUrl = `${status.url}${separator}folder=${encodeURIComponent(workingDirectory)}`;
          setIsRunning(true);
          setUrl(fullUrl);
          setIsLoading(false);
          return;
        }

        if (status.status === "error") {
          throw new Error(status.error || "VSCode failed to start");
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL));
      }

      throw new Error("VSCode startup timed out");
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("VSCode startup timed out");
      } else {
        setError(err instanceof Error ? err.message : "Failed to start VSCode");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const stop = useCallback(async (machineId: string) => {
    if (vscodeIdRef.current) {
      try {
        await stopRemoteVSCode(vscodeIdRef.current, machineId);
      } catch (err) {
        console.warn("Failed to stop remote VSCode:", err);
      }
    }
    setIsRunning(false);
    setUrl(null);
    setError(null);
    vscodeIdRef.current = null;
  }, []);

  return { isRunning, isLoading, error, url, start, stop };
}
