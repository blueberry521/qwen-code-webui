// API configuration - uses relative paths with Vite proxy in development
import { addTokenToUrl } from "../utils/token";

export const API_CONFIG = {
  ENDPOINTS: {
    VERSION: "/api/version",
    CHAT: "/api/chat",
    ABORT: "/api/abort",
    PERMISSION_RESPOND: "/api/permission/respond",
    PROJECTS: "/api/projects",
    HISTORIES: "/api/projects",
    CONVERSATIONS: "/api/projects",
    MODELS: "/api/models",
    GIT_STATUS: "/api/git/status",
    GIT_DIFF: "/api/git/diff",
    GIT_FILE: "/api/git/file",
    VSCODE_START: "/api/vscode/start",
    VSCODE_STOP: "/api/vscode/stop",
    VSCODE_STATUS: "/api/vscode/status",
  },
} as const;

// Helper function to get full API URL
export const getApiUrl = (endpoint: string) => {
  return addTokenToUrl(endpoint);
};

// Helper function to get abort URL
export const getAbortUrl = (requestId: string) => {
  return addTokenToUrl(`${API_CONFIG.ENDPOINTS.ABORT}/${requestId}`);
};

// Helper function to get chat URL
export const getChatUrl = () => {
  return addTokenToUrl(API_CONFIG.ENDPOINTS.CHAT);
};

// Helper function to get permission respond URL
export const getPermissionRespondUrl = () => {
  return addTokenToUrl(API_CONFIG.ENDPOINTS.PERMISSION_RESPOND);
};

// Helper function to get projects URL
export const getProjectsUrl = () => {
  return addTokenToUrl(API_CONFIG.ENDPOINTS.PROJECTS);
};

// Helper function to get histories URL
export const getHistoriesUrl = (projectPath: string) => {
  const encodedPath = encodeURIComponent(projectPath);
  return addTokenToUrl(
    `${API_CONFIG.ENDPOINTS.HISTORIES}/${encodedPath}/histories`
  );
};

// Helper function to get conversation URL
export const getConversationUrl = (
  encodedProjectName: string,
  sessionId: string,
  toolName?: string
) => {
  let url = `${API_CONFIG.ENDPOINTS.CONVERSATIONS}/${encodedProjectName}/histories/${sessionId}`;
  if (toolName) {
    url = `${url}?toolName=${encodeURIComponent(toolName)}`;
    return addTokenToUrl(url);
  }
  return addTokenToUrl(url);
};

// Helper function to get models URL
export const getModelsUrl = () => {
  return addTokenToUrl(API_CONFIG.ENDPOINTS.MODELS);
};

// Helper function to get version URL
export const getVersionUrl = () => {
  return addTokenToUrl(API_CONFIG.ENDPOINTS.VERSION);
};

// Helper functions for Git APIs
export const getGitStatusUrl = (workingDirectory: string) => {
  const params = new URLSearchParams({ workingDirectory });
  return addTokenToUrl(`${API_CONFIG.ENDPOINTS.GIT_STATUS}?${params}`);
};

export const getGitDiffUrl = (workingDirectory: string, file: string) => {
  const params = new URLSearchParams({ workingDirectory, file });
  return addTokenToUrl(`${API_CONFIG.ENDPOINTS.GIT_DIFF}?${params}`);
};

export const getGitFileUrl = (workingDirectory: string, file: string) => {
  const params = new URLSearchParams({ workingDirectory, file });
  return addTokenToUrl(`${API_CONFIG.ENDPOINTS.GIT_FILE}?${params}`);
};

// Helper functions for VS Code APIs
export const getVSCodeStartUrl = (workingDirectory: string) => {
  const params = new URLSearchParams({ workingDirectory });
  return addTokenToUrl(`${API_CONFIG.ENDPOINTS.VSCODE_START}?${params}`);
};

export const getVSCodeStopUrl = () =>
  addTokenToUrl(API_CONFIG.ENDPOINTS.VSCODE_STOP);

export const getVSCodeStatusUrl = () =>
  addTokenToUrl(API_CONFIG.ENDPOINTS.VSCODE_STATUS);