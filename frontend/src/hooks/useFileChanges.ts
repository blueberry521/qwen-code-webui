import { useState, useEffect, useCallback, useRef } from "react";
import type { FileChange, GitStatusResponse } from "../types/fileChanges";
import { getGitStatusUrl } from "../config/api";

interface FileChangesResult {
  files: FileChange[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: Date | null;
}

const POLL_INTERVAL = 5000;

export function useFileChanges(
  workingDirectory: string | undefined,
): FileChangesResult {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const refreshRef = useRef(0);

  const refresh = useCallback(() => {
    refreshRef.current += 1;
    setLastUpdated(new Date());
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!workingDirectory) return;

    setIsLoading(true);
    setError(null);

    try {
      const url = getGitStatusUrl(workingDirectory);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: GitStatusResponse = await response.json();
      setFiles(data.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load changes");
    } finally {
      setIsLoading(false);
      setLastUpdated(new Date());
    }
  }, [workingDirectory]);

  // Reset when workingDirectory changes
  useEffect(() => {
    setFiles([]);
    setError(null);
    if (workingDirectory) {
      fetchStatus();
    }
  }, [workingDirectory, fetchStatus]);

  // Polling
  useEffect(() => {
    if (!workingDirectory) return;

    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [workingDirectory, fetchStatus]);

  return { files, isLoading, error, refresh, lastUpdated };
}
