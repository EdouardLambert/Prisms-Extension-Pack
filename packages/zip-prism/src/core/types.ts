export type FilePreviewKind = 'text' | 'tabular' | 'image' | 'binary';

export interface ZipEntryInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  uncompressedSize: number;
  compressedSize: number;
  lastModified: string;
  extension: string;
}

export interface ZipTreeNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  uncompressedSize: number;
  compressedSize: number;
  fileCount: number;
  lastModified?: string;
  extension?: string;
  children: ZipTreeNode[];
}

export interface TabularPreviewData {
  delimiter: string;
  headers: string[];
  rows: string[][];
  totalPreviewRows: number;
}

export interface EntryPreviewResult {
  entry: ZipEntryInfo;
  kind: FilePreviewKind;
  truncated: boolean;
  textContent?: string;
  tabular?: TabularPreviewData;
  imageDataUri?: string;
  mimeType?: string;
}

export interface ContentSearchMatch {
  entryPath: string;
  line: number; // 1-based
  column: number; // 1-based
  previewLine: string;
  matchLength: number;
}

export interface ContentSearchOptions {
  caseSensitive?: boolean;
  maxMatches?: number;
  maxMatchesPerFile?: number;
  maxFileBytes?: number;
  maxTotalBytesScanned?: number;
}

export interface ContentSearchResult {
  query: string;
  matches: ContentSearchMatch[];
  filesScanned: number;
  filesSkipped: number;
  limitReached: boolean;
}