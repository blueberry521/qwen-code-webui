import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FileChangesHeader } from "./FileChangesHeader";
import { FileChangesList } from "./FileChangesList";
import { VSCodeEditor } from "./VSCodeEditor";
import { useFileChanges } from "../../hooks/useFileChanges";
import { useVSCode } from "../../hooks/useVSCode";
import type { FileChange } from "../../types/fileChanges";

interface FileChangesPanelProps {
  workingDirectory: string | undefined;
  onOpenDiff: (file: FileChange) => void;
  onClose: () => void;
  onVSCodeOpenChange?: (isOpen: boolean) => void;
  remoteWorkspace?: boolean;
}

export function FileChangesPanel({
  workingDirectory,
  onOpenDiff,
  onClose,
  onVSCodeOpenChange,
  remoteWorkspace = false,
}: FileChangesPanelProps) {
  const { t } = useTranslation();
  const { files, isLoading, error, refresh } = useFileChanges(
    workingDirectory,
    !remoteWorkspace,
  );
  const vscode = useVSCode();
  const [showVSCode, setShowVSCode] = useState(false);

  const handleToggleVSCode = useCallback(async () => {
    if (remoteWorkspace) return;

    if (showVSCode) {
      await vscode.stop();
      setShowVSCode(false);
    } else if (workingDirectory) {
      setShowVSCode(true);
      await vscode.start(workingDirectory);
    }
  }, [remoteWorkspace, showVSCode, workingDirectory, vscode]);

  const handleCloseVSCode = useCallback(async () => {
    await vscode.stop();
    setShowVSCode(false);
  }, [vscode]);

  useEffect(() => {
    onVSCodeOpenChange?.(showVSCode);
    return () => onVSCodeOpenChange?.(false);
  }, [onVSCodeOpenChange, showVSCode]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700">
      <FileChangesHeader
        fileCount={files.length}
        isLoading={isLoading}
        vscodeRunning={showVSCode && vscode.isRunning}
        actionsDisabled={remoteWorkspace}
        onRefresh={refresh}
        onToggleVSCode={handleToggleVSCode}
        onClose={onClose}
      />
      {showVSCode ? (
        <VSCodeEditor
          url={vscode.url}
          isLoading={vscode.isLoading}
          error={vscode.error}
          onClose={handleCloseVSCode}
        />
      ) : (
        <FileChangesList
          files={files}
          isLoading={isLoading}
          error={error}
          emptyMessage={
            remoteWorkspace ? t("fileChanges.remoteUnsupported") : undefined
          }
          onFileClick={onOpenDiff}
        />
      )}
    </div>
  );
}
