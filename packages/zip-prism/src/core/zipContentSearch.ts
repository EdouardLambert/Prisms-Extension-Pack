import { isBufferBinary, isLikelyBinaryExtension } from './fileClassifier.js';
import { ContentSearchMatch, ContentSearchOptions, ContentSearchResult } from './types.js';
import { ZipArchiveReader } from './zipArchiveReader.js';

const DEFAULT_OPTIONS: Required<ContentSearchOptions> = {
  caseSensitive: false,
  maxMatches: 200,
  maxMatchesPerFile: 25,
  maxFileBytes: 1024 * 1024, // 1 MB per entry
  maxTotalBytesScanned: 20 * 1024 * 1024, // 20 MB total per search
};

/**
 * Performs a bounded in-memory full-text search across text entries in a ZIP archive.
 */
export async function searchZipContent(
  reader: ZipArchiveReader,
  rawQuery: string,
  options: ContentSearchOptions = {}
): Promise<ContentSearchResult> {
  const query = rawQuery.trim();
  if (!query) {
    return {
      query: '',
      matches: [],
      filesScanned: 0,
      filesSkipped: 0,
      limitReached: false,
    };
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const needle = opts.caseSensitive ? query : query.toLowerCase();

  const matches: ContentSearchMatch[] = [];
  let filesScanned = 0;
  let filesSkipped = 0;
  let totalBytesScanned = 0;
  let limitReached = false;

  for (const entry of reader.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    if (matches.length >= opts.maxMatches || totalBytesScanned >= opts.maxTotalBytesScanned) {
      limitReached = true;
      break;
    }

    if (
      entry.uncompressedSize === 0 ||
      entry.uncompressedSize > opts.maxFileBytes ||
      isLikelyBinaryExtension(entry.extension)
    ) {
      filesSkipped++;
      continue;
    }

    let buffer: Buffer;
    try {
      const result = await reader.readEntryBytes(entry.path, opts.maxFileBytes);
      buffer = result.buffer;
    } catch {
      filesSkipped++;
      continue;
    }

    totalBytesScanned += buffer.length;
    if (isBufferBinary(buffer)) {
      filesSkipped++;
      continue;
    }

    filesScanned++;
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);
    let matchesInFile = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineText = lines[lineIdx] ?? '';
      const haystack = opts.caseSensitive ? lineText : lineText.toLowerCase();
      const matchCol = haystack.indexOf(needle);

      if (matchCol !== -1) {
        matches.push({
          entryPath: entry.path,
          line: lineIdx + 1,
          column: matchCol + 1,
          previewLine: truncateSnippet(lineText, matchCol, query.length, 160),
          matchLength: query.length,
        });

        matchesInFile++;
        if (matches.length >= opts.maxMatches) {
          limitReached = true;
          break;
        }
        if (matchesInFile >= opts.maxMatchesPerFile) {
          break;
        }
      }
    }
  }

  return {
    query,
    matches,
    filesScanned,
    filesSkipped,
    limitReached,
  };
}

function truncateSnippet(
  lineText: string,
  matchIndex: number,
  matchLength: number,
  maxLength: number
): string {
  const trimmed = lineText.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const start = Math.max(0, matchIndex - Math.floor((maxLength - matchLength) / 2));
  const end = Math.min(lineText.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < lineText.length ? '…' : '';
  return `${prefix}${lineText.slice(start, end).trim()}${suffix}`;
}