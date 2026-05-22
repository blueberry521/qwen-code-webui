import { useTranslation } from "react-i18next";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

interface VSCodeEditorProps {
  url: string | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

export function VSCodeEditor({
  url,
  isLoading,
  error,
  onClose,
}: VSCodeEditorProps) {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <p className="text-sm text-red-500 dark:text-red-400 mb-2">
            {error}
          </p>
          {error.includes("not installed") && (
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 rounded p-2 mt-2">
              curl -fsSL https://code-server.dev/install.sh | sh
            </p>
          )}
          <button
            onClick={onClose}
            className="mt-3 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            {t("fileChanges.closeVSCode")}
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !url) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <ArrowPathIcon className="w-6 h-6 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t("fileChanges.startingVSCode")}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {t("fileChanges.startingVSCodeHint", "Starting code-server (~1s)...")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      <iframe
        src={url}
        className="absolute inset-0 w-full h-full border-0"
        title="VS Code Editor"
        allow="clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      />
    </div>
  );
}
