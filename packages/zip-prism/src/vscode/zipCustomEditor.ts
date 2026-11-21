import * as path from 'path';
import * as vscode from 'vscode';
import { ZipArchiveReader } from '../core/zipArchiveReader.js';
import { searchZipContent } from '../core/zipContentSearch.js';
import { buildZipTree } from '../core/zipTreeBuilder.js';
import { buildZipEntryUri } from './zipUri.js';
import { buildZipWebviewHtml } from './zipWebviewHtml.js';

export const ZIP_PRISM_VIEW_TYPE = 'zipPrism.viewer';

class ZipArchiveDocument implements vscode.CustomDocument {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly reader: ZipArchiveReader
  ) {}

  dispose(): void {
    this.reader.close();
  }
}

type WebviewInboundMessage =
  | { type: 'ready' }
  | { type: 'requestPreview'; entryPath: string }
  | { type: 'openInEditor'; entryPath: string; line?: number }
  | { type: 'searchContent'; query: string }
  | { type: 'copyText'; text: string };

export class ZipCustomEditorProvider
  implements vscode.CustomReadonlyEditorProvider<ZipArchiveDocument>
{
  async openCustomDocument(uri: vscode.Uri): Promise<ZipArchiveDocument> {
    const reader = await ZipArchiveReader.open(uri.fsPath);
    return new ZipArchiveDocument(uri, reader);
  }

  async resolveCustomEditor(
    document: ZipArchiveDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    const archiveName = path.basename(document.uri.fsPath);
    webviewPanel.webview.html = buildZipWebviewHtml(archiveName);

    const entries = document.reader.getEntries();
    const fileEntries = entries.filter((e) => !e.isDirectory);
    const totalUncompressed = fileEntries.reduce((sum, e) => sum + e.uncompressedSize, 0);
    const totalCompressed = fileEntries.reduce((sum, e) => sum + e.compressedSize, 0);
    const tree = buildZipTree(entries);

    const listener = webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewInboundMessage) => {
        try {
          switch (message.type) {
            case 'ready': {
              await webviewPanel.webview.postMessage({
                type: 'init',
                tree,
                fileCount: fileEntries.length,
                totalUncompressed,
                totalCompressed,
              });
              break;
            }
            case 'requestPreview': {
              const preview = await document.reader.readEntryPreview(message.entryPath);
              await webviewPanel.webview.postMessage({
                type: 'preview',
                preview,
              });
              break;
            }
            case 'searchContent': {
              const result = await searchZipContent(document.reader, message.query);
              await webviewPanel.webview.postMessage({
                type: 'searchResults',
                result,
              });
              break;
            }
            case 'copyText': {
              await vscode.env.clipboard.writeText(message.text);
              void vscode.window.setStatusBarMessage('ZIP Prism: Copied to clipboard', 2000);
              break;
            }
            case 'openInEditor': {
              await this.openEntryInNativeEditor(
                document.uri.fsPath,
                message.entryPath,
                message.line
              );
              break;
            }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await webviewPanel.webview.postMessage({
            type: 'error',
            message: errorMessage,
          });
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      listener.dispose();
    });
  }

  private async openEntryInNativeEditor(
    archivePath: string,
    entryPath: string,
    line?: number
  ): Promise<void> {
    const virtualUri = buildZipEntryUri(archivePath, entryPath);
    const doc = await vscode.workspace.openTextDocument(virtualUri);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });

    if (line && line > 0) {
      const zeroBasedLine = Math.min(line - 1, Math.max(0, doc.lineCount - 1));
      const range = doc.lineAt(zeroBasedLine).range;
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }
  }
}