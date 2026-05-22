import { useState, useCallback } from "react";
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
}

export function FileChangesPanel({
  workingDirectory,
  onOpenDiff,
  onClose,
}: FileChangesPanelProps) {
  const { t } = useTranslation();
  const { files, isLoading, error, refresh } = useFileChanges(workingDirectory);
  const vscode = useVSCode();
  const [showVSCode, setShowVSCode] = useState(false);

  const handleToggleVSCode = useCallback(async () => {
    if (showVSCode) {
      await vscode.stop();
      setShowVSCode(false);
    } else if (workingDirectory) {
      setShowVSCode(true);
      await vscode.start(workingDirectory);
    }
  }, [showVSCode, workingDirectory, vscode]);

  const handleCloseVSCode = useCallback(async () => {
    await vscode.stop();
    setShowVSCode(false);
  }, [vscode]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700">
      <FileChangesHeader
        fileCount={files.length}
        isLoading={isLoading}
        vscodeRunning={showVSCode && vscode.isRunning}
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
          onFileClick={onOpenDiff}
        />
      )}
    </div>
  );
}
