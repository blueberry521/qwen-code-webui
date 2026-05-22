import { useTranslation } from "react-i18next";
import {
  CodeBracketSquareIcon,
  ArrowPathIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

interface FileChangesHeaderProps {
  fileCount: number;
  isLoading: boolean;
  vscodeRunning: boolean;
  onRefresh: () => void;
  onToggleVSCode: () => void;
  onClose: () => void;
}

export function FileChangesHeader({
  fileCount,
  isLoading,
  vscodeRunning,
  onRefresh,
  onToggleVSCode,
  onClose,
}: FileChangesHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex-shrink-0">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t("fileChanges.title")}
        </h3>
        {fileCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">
            {fileCount}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-50"
          title={t("fileChanges.refresh")}
        >
          <ArrowPathIcon
            className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
          />
        </button>
        <button
          onClick={onToggleVSCode}
          className={`p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 ${
            vscodeRunning
              ? "text-blue-500 hover:text-blue-700 dark:text-blue-400"
              : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          }`}
          title={
            vscodeRunning
              ? t("fileChanges.closeVSCode")
              : t("fileChanges.openInVSCode")
          }
        >
          <CodeBracketSquareIcon className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          title={t("chat.dismiss")}
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
