import { ZipEntryInfo, ZipTreeNode } from './types.js';

/**
 * Converts a flat list of ZIP entries into a sorted hierarchical tree.
 * Synthesizes missing intermediate folder nodes and aggregates folder sizes and file counts.
 */
export function buildZipTree(entries: ZipEntryInfo[]): ZipTreeNode[] {
  const roots: ZipTreeNode[] = [];
  const nodeMap = new Map<string, ZipTreeNode>();

  const getOrCreateFolder = (folderPath: string): ZipTreeNode => {
    const existing = nodeMap.get(folderPath);
    if (existing) {
      return existing;
    }

    const segments = folderPath.split('/');
    const name = segments[segments.length - 1] ?? folderPath;
    const node: ZipTreeNode = {
      id: folderPath,
      name,
      path: folderPath,
      isDirectory: true,
      uncompressedSize: 0,
      compressedSize: 0,
      fileCount: 0,
      children: [],
    };

    nodeMap.set(folderPath, node);

    if (segments.length === 1) {
      roots.push(node);
    } else {
      const parentPath = segments.slice(0, -1).join('/');
      const parent = getOrCreateFolder(parentPath);
      parent.children.push(node);
    }

    return node;
  };

  for (const entry of entries) {
    if (entry.isDirectory) {
      getOrCreateFolder(entry.path);
      continue;
    }

    const segments = entry.path.split('/');
    const fileNode: ZipTreeNode = {
      id: entry.path,
      name: entry.name,
      path: entry.path,
      isDirectory: false,
      uncompressedSize: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      fileCount: 1,
      lastModified: entry.lastModified,
      extension: entry.extension,
      children: [],
    };

    if (segments.length === 1) {
      roots.push(fileNode);
    } else {
      const parentPath = segments.slice(0, -1).join('/');
      const parent = getOrCreateFolder(parentPath);
      parent.children.push(fileNode);
    }
  }

  const finalize = (nodes: ZipTreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    for (const node of nodes) {
      if (node.isDirectory) {
        finalize(node.children);
        node.uncompressedSize = node.children.reduce((sum, c) => sum + c.uncompressedSize, 0);
        node.compressedSize = node.children.reduce((sum, c) => sum + c.compressedSize, 0);
        node.fileCount = node.children.reduce((sum, c) => sum + c.fileCount, 0);
      }
    }
  };

  finalize(roots);
  return roots;
}