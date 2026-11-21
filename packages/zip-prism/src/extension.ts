import * as vscode from 'vscode';
import { ZIP_PRISM_VIEW_TYPE, ZipCustomEditorProvider } from './vscode/zipCustomEditor.js';
import { ZipDocumentProvider } from './vscode/zipDocumentProvider.js';
import { ZIP_PRISM_SCHEME } from './vscode/zipUri.js';

export function activate(context: vscode.ExtensionContext): void {
  const documentProvider = new ZipDocumentProvider();
  const customEditorProvider = new ZipCustomEditorProvider();

  context.subscriptions.push(
    documentProvider,
    vscode.workspace.registerTextDocumentContentProvider(ZIP_PRISM_SCHEME, documentProvider),
    vscode.window.registerCustomEditorProvider(ZIP_PRISM_VIEW_TYPE, customEditorProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand('zipPrism.openArchive', async (resource?: vscode.Uri) => {
      const targetUri = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', targetUri, ZIP_PRISM_VIEW_TYPE);
    })
  );
}

export function deactivate(): void {
  // All resources are cleaned up via context.subscriptions
}