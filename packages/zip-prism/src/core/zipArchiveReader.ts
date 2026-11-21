import yauzl from 'yauzl';
import {
  classifyEntryPreview,
  extractExtension,
  getImageMimeType,
  normalizeZipEntryPath,
  parseTabularPreview,
} from './fileClassifier.js';
import { EntryPreviewResult, ZipEntryInfo } from './types.js';

export const DEFAULT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ReadBytesResult {
  buffer: Buffer;
  truncated: boolean;
}

/**
 * Lazy random-access ZIP reader backed by yauzl.
 * Only reads the Central Directory on open; entries are decompressed on demand in memory.
 */
export class ZipArchiveReader {
  private readonly rawEntries = new Map<string, yauzl.Entry>();
  private readonly entryInfos: ZipEntryInfo[] = [];
  private closed = false;

  private constructor(
    public readonly archivePath: string,
    private readonly zipfile: yauzl.ZipFile
  ) {}

  static open(archivePath: string): Promise<ZipArchiveReader> {
    return new Promise((resolve, reject) => {
      yauzl.open(
        archivePath,
        { lazyEntries: true, autoClose: false, decodeStrings: true },
        (openErr, zipfile) => {
          if (openErr || !zipfile) {
            reject(openErr ?? new Error(`Unable to open ZIP archive: ${archivePath}`));
            return;
          }

          const reader = new ZipArchiveReader(archivePath, zipfile);

          zipfile.on('entry', (entry: yauzl.Entry) => {
            const isDirectory = /\/$/.test(entry.fileName);
            const normalizedPath = normalizeZipEntryPath(entry.fileName);

            if (normalizedPath) {
              const name = normalizedPath.split('/').pop() ?? normalizedPath;
              const info: ZipEntryInfo = {
                path: normalizedPath,
                name,
                isDirectory,
                uncompressedSize: entry.uncompressedSize,
                compressedSize: entry.compressedSize,
                lastModified: entry.getLastModDate().toISOString(),
                extension: isDirectory ? '' : extractExtension(normalizedPath),
              };

              reader.entryInfos.push(info);
              if (!isDirectory) {
                reader.rawEntries.set(normalizedPath, entry);
              }
            }

            zipfile.readEntry();
          });

          zipfile.once('end', () => resolve(reader));
          zipfile.once('error', (err) => {
            reader.close();
            reject(err);
          });

          zipfile.readEntry();
        }
      );
    });
  }

  getEntries(): ZipEntryInfo[] {
    return this.entryInfos;
  }

  getEntryInfo(entryPath: string): ZipEntryInfo | undefined {
    return this.entryInfos.find((e) => !e.isDirectory && e.path === entryPath);
  }

  /**
   * Streams up to maxBytes of an entry into memory, aborting decompression early if exceeded.
   */
  readEntryBytes(
    entryPath: string,
    maxBytes = DEFAULT_PREVIEW_MAX_BYTES
  ): Promise<ReadBytesResult> {
    if (this.closed) {
      return Promise.reject(new Error('ZIP archive reader has been closed.'));
    }

    const rawEntry = this.rawEntries.get(entryPath);
    if (!rawEntry) {
      return Promise.reject(new Error(`Entry not found in archive: ${entryPath}`));
    }

    return new Promise((resolve, reject) => {
      this.zipfile.openReadStream(rawEntry, (streamErr, readStream) => {
        if (streamErr || !readStream) {
          reject(streamErr ?? new Error(`Unable to read entry stream: ${entryPath}`));
          return;
        }

        const chunks: Buffer[] = [];
        let totalLength = 0;
        let truncated = false;
        let settled = false;

        const finish = (err?: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (err) {
            reject(err);
          } else {
            resolve({ buffer: Buffer.concat(chunks, totalLength), truncated });
          }
        };

        readStream.on('data', (chunk: Buffer) => {
          if (settled) {
            return;
          }
          const remaining = maxBytes - totalLength;
          if (chunk.length > remaining) {
            if (remaining > 0) {
              chunks.push(chunk.subarray(0, remaining));
              totalLength += remaining;
            }
            truncated = true;
            readStream.destroy();
            finish();
            return;
          }

          chunks.push(chunk);
          totalLength += chunk.length;
        });

        readStream.once('end', () => finish());
        readStream.once('close', () => finish());
        readStream.once('error', (err) => {
          if (truncated) {
            finish();
          } else {
            finish(err);
          }
        });
      });
    });
  }

  async readEntryPreview(
    entryPath: string,
    maxBytes = DEFAULT_PREVIEW_MAX_BYTES
  ): Promise<EntryPreviewResult> {
    const entry = this.getEntryInfo(entryPath);
    if (!entry) {
      throw new Error(`Entry not found in archive: ${entryPath}`);
    }

    const { buffer, truncated } = await this.readEntryBytes(entryPath, maxBytes);
    const kind = classifyEntryPreview(entry.extension, buffer);

    if (kind === 'image') {
      const mimeType = getImageMimeType(entry.extension) ?? 'application/octet-stream';
      return {
        entry,
        kind,
        truncated,
        mimeType,
        imageDataUri: truncated
          ? undefined
          : `data:${mimeType};base64,${buffer.toString('base64')}`,
      };
    }

    if (kind === 'binary') {
      return { entry, kind, truncated };
    }

    const textContent = buffer.toString('utf8');
    if (kind === 'tabular') {
      return {
        entry,
        kind,
        truncated,
        textContent,
        tabular: parseTabularPreview(textContent, entry.extension, 100),
      };
    }

    return {
      entry,
      kind: 'text',
      truncated,
      textContent,
    };
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      try {
        this.zipfile.close();
      } catch {
        // Ignore close errors if already closed
      }
    }
  }
}