import { useState, useCallback } from "react";
import { getVSCodeStartUrl, getVSCodeStopUrl, getVSCodeStatusUrl } from "../config/api";

interface VSCodeState {
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  url: string | null;
  start: (workingDirectory: string) => Promise<void>;
  stop: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

export function useVSCode(): VSCodeState {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const start = useCallback(async (workingDirectory: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 35_000);

      const response = await fetch(getVSCodeStartUrl(workingDirectory), {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to start VS Code");
      }

      setIsRunning(true);
      setUrl(data.url);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("VS Code startup timed out");
      } else {
        setError(err instanceof Error ? err.message : "Failed to start VS Code");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await fetch(getVSCodeStopUrl(), { method: "DELETE" });
    } catch {
      // Ignore errors on stop
    }
    setIsRunning(false);
    setUrl(null);
    setError(null);
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch(getVSCodeStatusUrl());
      const data = await response.json();
      setIsRunning(data.running);
      setUrl(data.url || null);
    } catch {
      // Ignore
    }
  }, []);

  return { isRunning, isLoading, error, url, start, stop, checkStatus };
}
