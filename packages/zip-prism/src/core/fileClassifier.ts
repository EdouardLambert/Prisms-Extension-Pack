import { FilePreviewKind, TabularPreviewData } from './types.js';

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

const TABULAR_EXTENSIONS = new Set(['.csv', '.tsv']);

const KNOWN_BINARY_EXTENSIONS = new Set([
  '.pdf',
  '.parquet',
  '.avro',
  '.orc',
  '.xlsx',
  '.xls',
  '.docx',
  '.pptx',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
  '.sqlite',
  '.db',
  '.duckdb',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
]);

/**
 * Normalizes a raw ZIP entry path to POSIX slashes and rejects path traversal segments.
 * Returns null if the entry path is unsafe or empty.
 */
export function normalizeZipEntryPath(rawPath: string): string | null {
  const posix = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const trimmed = posix.replace(/\/+$/, '');
  if (!trimmed) {
    return null;
  }

  const segments = trimmed.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    return null;
  }

  return trimmed;
}

export function extractExtension(entryPath: string): string {
  const baseName = entryPath.split('/').pop() ?? '';
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx <= 0) {
    return '';
  }
  return baseName.slice(dotIdx).toLowerCase();
}

export function getImageMimeType(extension: string): string | undefined {
  return IMAGE_MIME_BY_EXT[extension.toLowerCase()];
}

export function isLikelyBinaryExtension(extension: string): boolean {
  const lower = extension.toLowerCase();
  return KNOWN_BINARY_EXTENSIONS.has(lower) || lower in IMAGE_MIME_BY_EXT;
}

/**
 * Detects whether a byte buffer is likely binary by scanning the first 8 KB for NUL bytes
 * or a high ratio of non-printable control characters.
 */
export function isBufferBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8192);
  if (sampleLength === 0) {
    return false;
  }

  let suspiciousCount = 0;
  for (let i = 0; i < sampleLength; i++) {
    const byte = buffer[i]!;
    if (byte === 0) {
      return true;
    }
    // Control chars excluding TAB (9), LF (10), CR (13)
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspiciousCount++;
    }
  }

  return suspiciousCount / sampleLength > 0.15;
}

export function classifyEntryPreview(extension: string, sampleBuffer: Buffer): FilePreviewKind {
  const lower = extension.toLowerCase();
  if (lower in IMAGE_MIME_BY_EXT) {
    return 'image';
  }
  if (KNOWN_BINARY_EXTENSIONS.has(lower) || isBufferBinary(sampleBuffer)) {
    return 'binary';
  }
  if (TABULAR_EXTENSIONS.has(lower)) {
    return 'tabular';
  }
  return 'text';
}

/**
 * Lightweight RFC-4180-compatible CSV/TSV parser for bounded table previews.
 */
export function parseTabularPreview(
  text: string,
  extension: string,
  maxRows = 100
): TabularPreviewData {
  const delimiter = extension.toLowerCase() === '.tsv' ? '\t' : detectCsvDelimiter(text);
  const parsedRows: string[][] = [];

  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        parsedRows.push(currentRow);
      }
      currentRow = [];
      // Stop after header + maxRows
      if (parsedRows.length > maxRows) {
        break;
      }
    } else {
      currentField += ch;
    }
  }

  if ((currentField.length > 0 || currentRow.length > 0) && parsedRows.length <= maxRows) {
    currentRow.push(currentField);
    parsedRows.push(currentRow);
  }

  const headers = parsedRows[0] ?? [];
  const rows = parsedRows.slice(1, maxRows + 1);

  return {
    delimiter,
    headers,
    rows,
    totalPreviewRows: rows.length,
  };
}

function detectCsvDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;

  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }

  return best;
}