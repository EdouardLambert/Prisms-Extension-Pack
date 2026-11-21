import * as vscode from 'vscode';
import { isBufferBinary } from '../core/fileClassifier.js';
import { DEFAULT_DOCUMENT_MAX_BYTES, ZipArchiveReader } from '../core/zipArchiveReader.js';
import { parseZipEntryUri } from './zipUri.js';

/**
 * Provides read-only virtual documents for files stored inside ZIP archives.
 */
export class ZipDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly readers = new Map<string, Promise<ZipArchiveReader>>();

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parsed = parseZipEntryUri(uri);
    if (!parsed) {
      throw new Error(`Invalid ZIP Prism URI: ${uri.toString()}`);
    }

    const reader = await this.getOrOpenReader(parsed.archivePath);
    const { buffer, truncated } = await reader.readEntryBytes(
      parsed.entryPath,
      DEFAULT_DOCUMENT_MAX_BYTES
    );

    if (isBufferBinary(buffer)) {
      return `[ZIP Prism] Binary file (${parsed.entryPath}) cannot be rendered as text.`;
    }

    const content = buffer.toString('utf8');
    if (truncated) {
      return `${content}\n\n/* [ZIP Prism] File truncated at ${Math.round(
        DEFAULT_DOCUMENT_MAX_BYTES / (1024 * 1024)
      )} MB for safety. */`;
    }

    return content;
  }

  invalidateArchive(archivePath: string): void {
    const pending = this.readers.get(archivePath);
    if (!pending) {
      return;
    }
    this.readers.delete(archivePath);
    void pending.then((reader) => reader.close()).catch(() => undefined);
  }

  dispose(): void {
    for (const pending of this.readers.values()) {
      void pending.then((reader) => reader.close()).catch(() => undefined);
    }
    this.readers.clear();
  }

  private getOrOpenReader(archivePath: string): Promise<ZipArchiveReader> {
    let readerPromise = this.readers.get(archivePath);
    if (!readerPromise) {
      readerPromise = ZipArchiveReader.open(archivePath).catch((err) => {
        this.readers.delete(archivePath);
        throw err;
      });
      this.readers.set(archivePath, readerPromise);
    }
    return readerPromise;
  }
}