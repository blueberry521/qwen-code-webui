export interface FileChange {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
}

export interface GitStatusResponse {
  files: FileChange[];
}

export interface GitDiffResponse {
  file: string;
  diff: string;
  originalContent: string;
  modifiedContent: string;
}

export interface GitFileResponse {
  file: string;
  content: string;
}
