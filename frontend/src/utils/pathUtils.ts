/**
 * Windows path normalization utilities
 */

/**
 * Normalize Windows paths for cross-platform compatibility
 * - Remove leading slash from Windows absolute paths like /C:/...
 * - Convert backslashes to forward slashes
 */
export function normalizeWindowsPath(path: string): string {
  return path.replace(/^\/([A-Za-z]:)/, "$1").replace(/\\/g, "/");
}

/**
 * Format path for VS Code folder parameter
 * - Adds leading / for Windows paths
 * - Converts backslashes to forward slashes
 * - Removes duplicate leading slashes
 * - Returns empty string for empty input
 */
export function formatVSCodeFolderPath(path: string): string {
  if (!path) return path;
  return "/" + path.replace(/\\/g, "/").replace(/^\/+/, "");
}
