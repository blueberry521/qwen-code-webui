import { CogIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";

interface SettingsButtonProps {
  onClick: () => void;
}

export function SettingsButton({ onClick }: SettingsButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow-md"
      aria-label={t("settings.open")}
      title={t("chat.settings")}
    >
      <CogIcon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
    </button>
  );
}
