import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeZipEntryPath, parseTabularPreview } from '../../src/core/fileClassifier.js';
import { ZipArchiveReader } from '../../src/core/zipArchiveReader.js';
import { searchZipContent } from '../../src/core/zipContentSearch.js';
import { buildZipTree } from '../../src/core/zipTreeBuilder.js';
import { createTempZipArchive } from '../helpers/zipFixture.js';

const tempFiles: string[] = [];

afterEach(async () => {
  while (tempFiles.length > 0) {
    const file = tempFiles.pop()!;
    await fs.rm(path.dirname(file), { recursive: true, force: true });
  }
});

describe('ZIP Prism Core', () => {
  it('rejects path traversal and normalizes Windows separators', () => {
    expect(normalizeZipEntryPath('logs\\2026\\run.log')).toBe('logs/2026/run.log');
    expect(normalizeZipEntryPath('../etc/passwd')).toBeNull();
    expect(normalizeZipEntryPath('a/b/../secret.txt')).toBeNull();
  });

  it('builds a hierarchical tree, previews CSV & text, and truncates oversized entries', async () => {
    const zipPath = await createTempZipArchive([
      { name: 'models/orders.sql', content: 'select order_id, total_amount from raw_orders;' },
      { name: 'exports/report.csv', content: 'id;status;amount\n1;PAID;42.50\n2;PENDING;19.00\n' },
      { name: 'bin/payload.bin', content: Buffer.from([0x00, 0x01, 0x02, 0xff]) },
    ]);
    tempFiles.push(zipPath);

    const reader = await ZipArchiveReader.open(zipPath);
    try {
      const tree = buildZipTree(reader.getEntries());
      expect(tree.map((n) => n.name)).toEqual(['bin', 'exports', 'models']);
      expect(tree[2]?.fileCount).toBe(1);

      const csvPreview = await reader.readEntryPreview('exports/report.csv');
      expect(csvPreview.kind).toBe('tabular');
      expect(csvPreview.tabular?.delimiter).toBe(';');
      expect(csvPreview.tabular?.headers).toEqual(['id', 'status', 'amount']);
      expect(csvPreview.tabular?.rows).toHaveLength(2);

      const binPreview = await reader.readEntryPreview('bin/payload.bin');
      expect(binPreview.kind).toBe('binary');

      const truncated = await reader.readEntryBytes('models/orders.sql', 10);
      expect(truncated.truncated).toBe(true);
      expect(truncated.buffer.toString('utf8')).toBe('select ord');
    } finally {
      reader.close();
    }
  });

  it('searches content across text files while skipping binary entries', async () => {
    const zipPath = await createTempZipArchive([
      { name: 'logs/app.log', content: 'INFO start\nERROR invoice_9941 failed\nINFO done\n' },
      { name: 'data/meta.json', content: '{"ref": "INVOICE_9941", "ok": false}' },
      { name: 'bin/raw.dat', content: Buffer.from([0x00, 0x49, 0x4e, 0x56, 0x4f, 0x49, 0x43, 0x45]) },
    ]);
    tempFiles.push(zipPath);

    const reader = await ZipArchiveReader.open(zipPath);
    try {
      const result = await searchZipContent(reader, 'invoice_9941');
      expect(result.filesScanned).toBe(2);
      expect(result.filesSkipped).toBe(1);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]).toMatchObject({
        entryPath: 'logs/app.log',
        line: 2,
      });
      expect(result.matches[1]).toMatchObject({
        entryPath: 'data/meta.json',
        line: 1,
      });
    } finally {
      reader.close();
    }
  });

  it('handles quoted CSV fields containing delimiters', () => {
    const parsed = parseTabularPreview('name,note\n"Alice","a, b, c"\n', '.csv');
    expect(parsed.rows[0]).toEqual(['Alice', 'a, b, c']);
  });
});