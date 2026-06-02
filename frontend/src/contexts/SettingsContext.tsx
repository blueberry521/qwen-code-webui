import React, { useState, useEffect, useCallback, useMemo } from "react";
import type {
  AppSettings,
  SettingsContextType,
  ExperimentalFeatures,
  Theme,
} from "../types/settings";
import { getSettings, setSettings } from "../utils/storage";
import { SettingsContext } from "./SettingsContextTypes";
import { DEFAULT_EXPERIMENTAL } from "../types/settings";

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(() =>
    getSettings(),
  );
  const [isInitialized, setIsInitialized] = useState(false);

  // Detect if running in iframe (embedded mode)
  const isEmbeddedMode = useMemo(
    () => typeof window !== "undefined" && window.parent !== window,
    [],
  );

  // Initialize settings on client side (handles migration automatically)
  // Also check for URL parameter theme override (Issue #104 - iframe theme sync)
  useEffect(() => {
    const initialSettings = getSettings();

    // Check URL parameter for theme override
    const urlParams = new URLSearchParams(window.location.search);
    const themeParam = urlParams.get("theme");
    if (themeParam === "dark" || themeParam === "light") {
      initialSettings.theme = themeParam as Theme;
    }

    setSettingsState(initialSettings);
    setIsInitialized(true);
  }, []);

  // Listen for postMessage theme updates from parent window (Issue #104 - realtime sync)
  useEffect(() => {
    if (!isEmbeddedMode) return;

    // Get trusted origin from URL parameter (handles cross-origin iframe scenario)
    const urlParams = new URLSearchParams(window.location.search);
    const openaceUrl = urlParams.get("openace_url");
    const trustedOrigin = openaceUrl ? new URL(openaceUrl).origin : null;

    const handleMessage = (event: MessageEvent) => {
      // Validate message type
      if (event.data?.type !== "openace-theme-change") return;

      // Validate origin for security (use openace_url parameter for cross-origin scenario)
      // When iframe is cross-origin, we cannot access window.parent.location.origin
      // Instead, we use the openace_url parameter passed from parent
      if (trustedOrigin && event.origin !== trustedOrigin) {
        console.warn("Received theme change from untrusted origin:", event.origin);
        return;
      }

      const newTheme = event.data.theme;
      if (newTheme === "dark" || newTheme === "light") {
        setSettingsState((prev) => ({ ...prev, theme: newTheme as Theme }));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isEmbeddedMode]);

  // Apply theme changes to document when settings change
  useEffect(() => {
    if (!isInitialized) return;

    const root = window.document.documentElement;

    if (settings.theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Save settings to storage
    setSettings(settings);
  }, [settings, isInitialized]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...updates }));
  }, []);

  const toggleTheme = useCallback(() => {
    updateSettings({
      theme: settings.theme === "light" ? "dark" : "light",
    });
  }, [settings.theme, updateSettings]);

  const toggleEnterBehavior = useCallback(() => {
    updateSettings({
      enterBehavior: settings.enterBehavior === "send" ? "newline" : "send",
    });
  }, [settings.enterBehavior, updateSettings]);

  const toggleExpandThinking = useCallback(() => {
    updateSettings({
      expandThinking: !settings.expandThinking,
    });
  }, [settings.expandThinking, updateSettings]);

  // Get experimental features with defaults
  const experimental: ExperimentalFeatures = useMemo(
    () => ({
      ...DEFAULT_EXPERIMENTAL,
      ...settings.experimental,
    }),
    [settings.experimental],
  );

  const value = useMemo(
    (): SettingsContextType => ({
      settings,
      theme: settings.theme,
      enterBehavior: settings.enterBehavior,
      experimental,
      expandThinking: settings.expandThinking ?? true, // Default to expanded
      isEmbeddedMode,
      toggleTheme,
      toggleEnterBehavior,
      toggleExpandThinking,
      updateSettings,
    }),
    [settings, experimental, isEmbeddedMode, toggleTheme, toggleEnterBehavior, toggleExpandThinking, updateSettings],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
