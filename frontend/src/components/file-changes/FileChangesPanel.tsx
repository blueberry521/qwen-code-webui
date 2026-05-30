import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileChangesHeader } from "./FileChangesHeader";
import { FileChangesList } from "./FileChangesList";
import { VSCodeEditor } from "./VSCodeEditor";
import { useFileChanges } from "../../hooks/useFileChanges";
import { useVSCode } from "../../hooks/useVSCode";
import { useRemoteVSCode } from "../../hooks/useRemoteVSCode";
import type { FileChange } from "../../types/fileChanges";

interface FileChangesPanelProps {
  workingDirectory: string | undefined;
  onOpenDiff: (file: FileChange) => void;
  onClose: () => void;
  onVSCodeOpenChange?: (isOpen: boolean) => void;
  remoteWorkspace?: boolean;
  machineId?: string;
}

export function FileChangesPanel({
  workingDirectory,
  onOpenDiff,
  onClose,
  onVSCodeOpenChange,
  remoteWorkspace = false,
  machineId,
}: FileChangesPanelProps) {
  const { t } = useTranslation();
  const { files, isLoading, error, refresh } = useFileChanges(
    workingDirectory,
    true,
    remoteWorkspace,
    machineId,
  );
  // Local and remote VSCode hooks - choose based on mode
  const localVSCode = useVSCode();
  const remoteVSCode = useRemoteVSCode();
  const [showVSCode, setShowVSCode] = useState(false);

  // Get the active VSCode state based on mode (memoized to avoid unnecessary re-renders)
  const activeVSCode = useMemo(
    () =>
      remoteWorkspace
        ? { isRunning: remoteVSCode.isRunning, isLoading: remoteVSCode.isLoading, error: remoteVSCode.error, url: remoteVSCode.url }
        : { isRunning: localVSCode.isRunning, isLoading: localVSCode.isLoading, error: localVSCode.error, url: localVSCode.url },
    [remoteWorkspace, remoteVSCode, localVSCode],
  );

  const handleToggleVSCode = useCallback(async () => {
    if (showVSCode) {
      if (remoteWorkspace) {
        await remoteVSCode.stop(machineId || "");
      } else {
        await localVSCode.stop();
      }
      setShowVSCode(false);
    } else if (workingDirectory) {
      setShowVSCode(true);
      if (remoteWorkspace && machineId) {
        await remoteVSCode.start(machineId, workingDirectory);
      } else {
        await localVSCode.start(workingDirectory);
      }
    }
  }, [remoteWorkspace, showVSCode, workingDirectory, machineId, localVSCode, remoteVSCode]);

  const handleCloseVSCode = useCallback(async () => {
    if (remoteWorkspace) {
      await remoteVSCode.stop(machineId || "");
    } else {
      await localVSCode.stop();
    }
    setShowVSCode(false);
  }, [remoteWorkspace, machineId, localVSCode, remoteVSCode]);

  useEffect(() => {
    onVSCodeOpenChange?.(showVSCode);
    return () => onVSCodeOpenChange?.(false);
  }, [onVSCodeOpenChange, showVSCode]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700">
      <FileChangesHeader
        fileCount={files.length}
        isLoading={isLoading}
        vscodeRunning={showVSCode && activeVSCode.isRunning}
        onRefresh={refresh}
        onToggleVSCode={handleToggleVSCode}
        onClose={onClose}
      />
      {showVSCode ? (
        <VSCodeEditor
          url={activeVSCode.url}
          isLoading={activeVSCode.isLoading}
          error={activeVSCode.error}
          onClose={handleCloseVSCode}
        />
      ) : (
        <FileChangesList
          files={files}
          isLoading={isLoading}
          error={error}
          onFileClick={onOpenDiff}
        />
      )}
    </div>
  );
}
