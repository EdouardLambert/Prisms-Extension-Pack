import * as vscode from 'vscode';

export const ZIP_PRISM_SCHEME = 'zip-prism';

export interface ParsedZipUri {
  archivePath: string;
  entryPath: string;
}

/**
 * Builds a virtual VS Code URI whose path ends with the entry filename so VS Code
 * automatically resolves the proper language mode and tab icon.
 */
export function buildZipEntryUri(archivePath: string, entryPath: string): vscode.Uri {
  const params = new URLSearchParams({
    archive: archivePath,
    entry: entryPath,
  });

  return vscode.Uri.from({
    scheme: ZIP_PRISM_SCHEME,
    path: `/${entryPath}`,
    query: params.toString(),
  });
}

export function parseZipEntryUri(uri: vscode.Uri): ParsedZipUri | undefined {
  if (uri.scheme !== ZIP_PRISM_SCHEME) {
    return undefined;
  }

  const params = new URLSearchParams(uri.query);
  const archivePath = params.get('archive');
  const entryPath = params.get('entry');
  if (!archivePath || !entryPath) {
    return undefined;
  }

  return { archivePath, entryPath };
}