// src/core/parser/sqlLocationFinder.ts

import { DbtRelationToken, SourceLocation } from './types.js';

export interface CteLocationBlock {
  cteName: string;
  nameLocation: SourceLocation;
  bodyStartOffset: number;
  bodyEndOffset: number;
}

export interface CursorDefinitionToken {
  word: string;
  qualifier?: string;
  isQualifierBeforeDot: boolean;
  isAfterFromOrJoin: boolean;
  startOffset: number;
  endOffset: number;
}

const SQL_COMMENT_OR_STRING_REGEX = /(--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*')/g;

const STOP_CLAUSE_AT_DEPTH_ZERO_REGEX =
  /^\b(?:FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|QUALIFY|WINDOW|UNION|EXCEPT|INTERSECT)\b/i;

/**
 * Masks SQL comments and string literals with spaces while preserving exact byte length and newlines.
 */
export function maskCommentsAndStrings(sql: string): string {
  return sql.replace(SQL_COMMENT_OR_STRING_REGEX, (match) =>
    match.replace(/[^\r\n]/g, ' ')
  );
}

/**
 * Converts a 0-based character range [startOffset, endOffset] into a 0-based SourceLocation.
 */
export function offsetRangeToSourceLocation(
  text: string,
  filePath: string,
  startOffset: number,
  endOffset: number
): SourceLocation {
  let line = 0;
  let lastNewlineIdx = -1;

  const clampedStart = Math.max(0, Math.min(startOffset, text.length));
  for (let i = 0; i < clampedStart; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNewlineIdx = i;
    }
  }

  const startColumn = clampedStart - (lastNewlineIdx + 1);
  const length = Math.max(0, endOffset - startOffset);

  return {
    filePath,
    line,
    startColumn,
    endColumn: startColumn + length,
  };
}

/**
 * Finds all CTE definitions (`WITH name AS (...)`) at parenthesis depth 0,
 * returning their header name location and body offset boundaries.
 */
export function locateCteDefinitions(
  sanitizedSql: string,
  filePath: string
): Map<string, CteLocationBlock> {
  const cleanSql = maskCommentsAndStrings(sanitizedSql);
  const result = new Map<string, CteLocationBlock>();

  let depth = 0;
  let i = 0;
  const len = cleanSql.length;

  while (i < len) {
    const ch = cleanSql[i];
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (depth === 0) {
      const slice = cleanSql.slice(i);
      const cteHeaderMatch = /^([a-zA-Z0-9_]+)\s+AS\s*\(/i.exec(slice);
      // Ensure we are at a word boundary
      const prevChar = i > 0 ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (cteHeaderMatch && !/[a-zA-Z0-9_]/.test(prevChar)) {
        const rawCteName = cteHeaderMatch[1] ?? '';
        const nameStart = i;
        const nameEnd = i + rawCteName.length;
        const openParenOffset = i + cteHeaderMatch[0].length - 1;

        // Scan forward to find matching closing parenthesis
        let innerDepth = 1;
        let j = openParenOffset + 1;
        while (j < len && innerDepth > 0) {
          if (cleanSql[j] === '(') innerDepth++;
          else if (cleanSql[j] === ')') innerDepth--;
          j++;
        }

        const closeParenOffset = j - 1;
        result.set(rawCteName.toLowerCase(), {
          cteName: rawCteName,
          nameLocation: offsetRangeToSourceLocation(
            sanitizedSql,
            filePath,
            nameStart,
            nameEnd
          ),
          bodyStartOffset: openParenOffset + 1,
          bodyEndOffset: Math.max(openParenOffset + 1, closeParenOffset),
        });

        i = j;
        continue;
      }
    }

    i++;
  }

  return result;
}

/**
 * Locates the exact SourceLocation of every explicitly projected column inside a SELECT block
 * bounded by [blockStartOffset, blockEndOffset].
 */
export function locateSelectProjectionColumns(
  sanitizedSql: string,
  filePath: string,
  blockStartOffset: number,
  blockEndOffset: number
): Map<string, SourceLocation> {
  const cleanSql = maskCommentsAndStrings(sanitizedSql);
  const locations = new Map<string, SourceLocation>();

  // 1. Find the first top-level SELECT keyword inside [blockStartOffset, blockEndOffset]
  let depth = 0;
  let selectEndOffset = -1;

  for (let i = blockStartOffset; i < blockEndOffset; i++) {
    const ch = cleanSql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const prevChar = i > blockStartOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        const selectMatch = /^SELECT(?:\s+(?:DISTINCT|ALL))?\b/i.exec(
          cleanSql.slice(i, blockEndOffset)
        );
        if (selectMatch) {
          selectEndOffset = i + selectMatch[0].length;
          break;
        }
      }
    }
  }

  if (selectEndOffset === -1) {
    return locations;
  }

  // 2. Collect top-level comma-separated projection item spans until top-level FROM/WHERE/etc.
  const itemSpans: Array<{ start: number; end: number }> = [];
  let itemStart = selectEndOffset;
  depth = 0;

  for (let i = selectEndOffset; i < blockEndOffset; i++) {
    const ch = cleanSql[i];
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      if (ch === ',') {
        itemSpans.push({ start: itemStart, end: i });
        itemStart = i + 1;
        continue;
      }

      const prevChar = i > selectEndOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        if (STOP_CLAUSE_AT_DEPTH_ZERO_REGEX.test(cleanSql.slice(i, blockEndOffset))) {
          itemSpans.push({ start: itemStart, end: i });
          itemStart = -1;
          break;
        }
      }
    }
  }

  if (itemStart !== -1 && itemStart < blockEndOffset) {
    itemSpans.push({ start: itemStart, end: blockEndOffset });
  }

  // 3. Extract the defined column identifier and its exact offset from each projection span
  for (const span of itemSpans) {
    const rawSlice = cleanSql.slice(span.start, span.end);
    if (!rawSlice.trim() || rawSlice.trim().endsWith('*')) {
      continue;
    }

    // Check for explicit `AS <alias>` at the end of the projection item
    const explicitAsMatch = /\bAS\s+([a-zA-Z0-9_]+)\s*$/i.exec(rawSlice);
    if (explicitAsMatch && explicitAsMatch[1]) {
      const aliasName = explicitAsMatch[1];
      const aliasStartInSlice =
        explicitAsMatch.index + explicitAsMatch[0].lastIndexOf(aliasName);
      const absStart = span.start + aliasStartInSlice;
      const absEnd = absStart + aliasName.length;

      locations.set(
        aliasName.toLowerCase(),
        offsetRangeToSourceLocation(sanitizedSql, filePath, absStart, absEnd)
      );
      continue;
    }

    // Otherwise strip any trailing Postgres/DuckDB `::TYPE` cast and match the trailing column identifier
    const withoutCast = rawSlice.replace(
      /::\s*[a-zA-Z0-9_]+(?:\s*\([^)]*\))?\s*$/,
      (m) => ' '.repeat(m.length)
    );

    const trailingIdMatch = /([a-zA-Z0-9_]+)\s*$/.exec(withoutCast);
    if (trailingIdMatch && trailingIdMatch[1]) {
      const colName = trailingIdMatch[1];
      const absStart = span.start + trailingIdMatch.index;
      const absEnd = absStart + colName.length;

      locations.set(
        colName.toLowerCase(),
        offsetRangeToSourceLocation(sanitizedSql, filePath, absStart, absEnd)
      );
    }
  }

  return locations;
}

/**
 * Extracts the identifier token under the cursor and its syntactic surroundings for Go-to-Definition.
 */
export function extractCursorTokenForDefinition(
  sanitizedSql: string,
  cursorOffset: number
): CursorDefinitionToken | null {
  const len = sanitizedSql.length;
  if (len === 0) return null;

  let probe = Math.max(0, Math.min(cursorOffset, len));
  // If cursor is at the exact end of an identifier, step back 1 char
  if (
    probe > 0 &&
    (probe === len || !/[a-zA-Z0-9_]/.test(sanitizedSql[probe] ?? '')) &&
    /[a-zA-Z0-9_]/.test(sanitizedSql[probe - 1] ?? '')
  ) {
    probe--;
  }

  if (!/[a-zA-Z0-9_]/.test(sanitizedSql[probe] ?? '')) {
    return null;
  }

  let start = probe;
  while (start > 0 && /[a-zA-Z0-9_]/.test(sanitizedSql[start - 1] ?? '')) {
    start--;
  }

  let end = probe + 1;
  while (end < len && /[a-zA-Z0-9_]/.test(sanitizedSql[end] ?? '')) {
    end++;
  }

  const word = sanitizedSql.slice(start, end);
  const beforeWord = sanitizedSql.slice(0, start);
  const afterWord = sanitizedSql.slice(end);

  const dotBeforeMatch = /([a-zA-Z0-9_]+)\.\s*$/.exec(beforeWord);
  const qualifier = dotBeforeMatch?.[1];
  const isQualifierBeforeDot = /^\s*\./.test(afterWord);
  const isAfterFromOrJoin =
    /\b(?:FROM|JOIN)\s+(?:[a-zA-Z0-9_]+\s+(?:AS\s+)?)?$/i.test(beforeWord);

  return {
    word,
    qualifier,
    isQualifierBeforeDot,
    isAfterFromOrJoin,
    startOffset: start,
    endOffset: end,
  };
}

// À ajouter à la fin de src/core/parser/sqlLocationFinder.ts :

const SQL_CLAUSE_RESERVED_WORDS = new Set([
  'on',
  'using',
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'qualify',
  'window',
  'union',
  'except',
  'intersect',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'outer',
  'lateral',
  'as',
]);

/**
 * Locates the exact SourceLocation of table aliases (or unaliased table names)
 * declared in the FROM and JOIN clauses of the active query block [blockStartOffset, blockEndOffset].
 */
export function locateFromJoinAliases(
  sanitizedSql: string,
  filePath: string,
  blockStartOffset: number,
  blockEndOffset: number,
  relations: Map<string, DbtRelationToken>
): Map<string, SourceLocation> {
  const cleanSql = maskCommentsAndStrings(sanitizedSql);
  const aliasLocations = new Map<string, SourceLocation>();

  let depth = 0;
  let i = blockStartOffset;
  const limit = Math.min(blockEndOffset, cleanSql.length);

  while (i < limit) {
    const ch = cleanSql[i];
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (depth === 0) {
      const prevChar = i > blockStartOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        const slice = cleanSql.slice(i, limit);
        const clauseMatch =
          /^(?:FROM|JOIN)\s+([a-zA-Z0-9_]+)(?:[ \t\r\n]+(?:AS[ \t\r\n]+)?([a-zA-Z0-9_]+))?/i.exec(
            slice
          );

        if (clauseMatch && clauseMatch[1]) {
          const rawTableToken = clauseMatch[1];
          const rawCandidateAlias = clauseMatch[2];

          const tableStartInSlice = clauseMatch[0].indexOf(rawTableToken);
          const absTableStart = i + tableStartInSlice;
          const absTableEnd = absTableStart + rawTableToken.length;

          const dbtRel = relations.get(rawTableToken.toLowerCase());
          const canonicalTableName = (
            dbtRel?.modelOrTableName ?? rawTableToken
          ).toLowerCase();

          const hasValidAlias =
            Boolean(rawCandidateAlias) &&
            !SQL_CLAUSE_RESERVED_WORDS.has(rawCandidateAlias!.toLowerCase());

          if (hasValidAlias && rawCandidateAlias) {
            const aliasStartInSlice = clauseMatch[0].lastIndexOf(rawCandidateAlias);
            const absAliasStart = i + aliasStartInSlice;
            const absAliasEnd = absAliasStart + rawCandidateAlias.length;

            const aliasLoc = offsetRangeToSourceLocation(
              sanitizedSql,
              filePath,
              absAliasStart,
              absAliasEnd
            );
            aliasLocations.set(rawCandidateAlias.toLowerCase(), aliasLoc);
            aliasLocations.set(canonicalTableName, aliasLoc);
          } else {
            const tableLoc = offsetRangeToSourceLocation(
              sanitizedSql,
              filePath,
              absTableStart,
              absTableEnd
            );
            aliasLocations.set(canonicalTableName, tableLoc);
          }

          i += clauseMatch[0].length;
          continue;
        }
      }
    }

    i++;
  }

  return aliasLocations;
}

export interface ScannedProjection {
  kind: 'column' | 'star';
  name?: string;
  qualifier?: string;
  sourceColumn?: string;
  excludedColumns?: Set<string>;
  inferredType?: string;
  location?: SourceLocation;
}

export interface ScannedFromRelation {
  aliasOrName: string;
  targetName: string;
  isDbtSource: boolean;
}

const SYNTHETIC_JINJA_ID_REGEX = /^_[rsj]\d+_*$/i;

const NON_COLUMN_TRAILING_KEYWORDS = new Set([
  'null',
  'true',
  'false',
  'end',
  'else',
  'then',
  'case',
  'and',
  'or',
  'not',
  'distinct',
  'all',
]);

const TRAILING_CAST_TYPE_REGEX =
  /::\s*(character\s+varying|double\s+precision|timestamp\s+with(?:out)?\s+time\s+zone|time\s+with(?:out)?\s+time\s+zone|bit\s+varying|[a-zA-Z_][a-zA-Z0-9_]*)(\s*\(\s*[^()]*\s*\))?(\s*\[\s*\])*\s*$/i;

const FUNC_CAST_TYPE_REGEX =
  /^(?:TRY_CAST|SAFE_CAST|CAST)\s*\([\s\S]*\bAS\s+(character\s+varying|double\s+precision|timestamp\s+with(?:out)?\s+time\s+zone|time\s+with(?:out)?\s+time\s+zone|bit\s+varying|[a-zA-Z_][a-zA-Z0-9_]*)(\s*\(\s*[^()]*\s*\))?(\s*\[\s*\])*\s*\)\s*$/i;

function inferTypeFromRawProjection(exprWithoutAlias: string): string | undefined {
  const trimmed = exprWithoutAlias.trim();
  if (!trimmed) return undefined;

  const formatTypeMatch = (match: RegExpExecArray): string => {
    const base = (match[1] ?? '').replace(/\s+/g, ' ').toUpperCase();
    const params = match[2] ? match[2].replace(/\s+/g, '') : '';
    const arraySuffix = match[3] ? '[]' : '';
    return `${base}${params}${arraySuffix}`;
  };

  const doubleColonMatch = TRAILING_CAST_TYPE_REGEX.exec(trimmed);
  if (doubleColonMatch) {
    return formatTypeMatch(doubleColonMatch);
  }

  const funcCastMatch = FUNC_CAST_TYPE_REGEX.exec(trimmed);
  if (funcCastMatch) {
    return formatTypeMatch(funcCastMatch);
  }

  if (/^COUNT\s*\(/i.test(trimmed)) return 'BIGINT';
  if (/^(?:SUM|AVG)\s*\(/i.test(trimmed)) return 'NUMERIC';

  return undefined;
}

/**
 * Dialect-agnostic scanner that extracts projected columns, star expansions (including DuckDB EXCLUDE),
 * inferred cast/aggregate types, and exact source locations from a SELECT block.
 */
export function scanSelectProjections(
  sanitizedSql: string,
  filePath: string,
  blockStartOffset: number,
  blockEndOffset: number
): ScannedProjection[] {
  const cleanSql = maskCommentsAndStrings(sanitizedSql);
  const projections: ScannedProjection[] = [];

  // 1. Find the first top-level SELECT keyword inside [blockStartOffset, blockEndOffset]
  let depth = 0;
  let selectEndOffset = -1;

  for (let i = blockStartOffset; i < blockEndOffset; i++) {
    const ch = cleanSql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const prevChar = i > blockStartOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        const selectMatch = /^SELECT(?:\s+(?:DISTINCT(?:\s+ON\s*\([^)]*\))?|ALL))?\b/i.exec(
          cleanSql.slice(i, blockEndOffset)
        );
        if (selectMatch) {
          selectEndOffset = i + selectMatch[0].length;
          break;
        }
      }
    }
  }

  if (selectEndOffset === -1) {
    return projections;
  }

  // 2. Split projection items by top-level commas until FROM / WHERE / QUALIFY / etc.
  const itemSpans: Array<{ start: number; end: number }> = [];
  let itemStart = selectEndOffset;
  depth = 0;

  for (let i = selectEndOffset; i < blockEndOffset; i++) {
    const ch = cleanSql[i];
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      if (ch === ',') {
        itemSpans.push({ start: itemStart, end: i });
        itemStart = i + 1;
        continue;
      }

      const prevChar = i > selectEndOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        if (STOP_CLAUSE_AT_DEPTH_ZERO_REGEX.test(cleanSql.slice(i, blockEndOffset))) {
          itemSpans.push({ start: itemStart, end: i });
          itemStart = -1;
          break;
        }
      }
    }
  }

  if (itemStart !== -1 && itemStart < blockEndOffset) {
    itemSpans.push({ start: itemStart, end: blockEndOffset });
  }

  // 3. Parse each projection item
  for (const span of itemSpans) {
    const rawSlice = cleanSql.slice(span.start, span.end);
    const trimmed = rawSlice.trim();
    if (!trimmed || SYNTHETIC_JINJA_ID_REGEX.test(trimmed)) {
      continue;
    }

    // Handle * or alias.* (with optional DuckDB EXCLUDE (col1, col2))
    const starMatch = /^(?:([a-zA-Z0-9_]+)\s*\.\s*)?\*(?:\s+EXCLUDE\s*\(([^)]*)\))?/i.exec(trimmed);
    if (starMatch) {
      const excludedColumns = new Set<string>();
      if (starMatch[2]) {
        for (const col of starMatch[2].split(',')) {
          const cleanCol = col.trim().replace(/^"|"$/g, '').toLowerCase();
          if (cleanCol) excludedColumns.add(cleanCol);
        }
      }
      projections.push({
        kind: 'star',
        qualifier: starMatch[1],
        excludedColumns: excludedColumns.size > 0 ? excludedColumns : undefined,
      });
      continue;
    }

    // Check for explicit `AS <alias>` at depth 0
    const explicitAsMatch = /\bAS\s+"?([a-zA-Z0-9_]+)"?\s*$/i.exec(rawSlice);
    if (explicitAsMatch && explicitAsMatch[1]) {
      const aliasName = explicitAsMatch[1];
      if (SYNTHETIC_JINJA_ID_REGEX.test(aliasName)) continue;

      const exprBeforeAs = rawSlice.slice(0, explicitAsMatch.index).trim();
      const inferredType = inferTypeFromRawProjection(exprBeforeAs);
      const exprWithoutCast = exprBeforeAs.replace(TRAILING_CAST_TYPE_REGEX, '').trim();
      const directSourceMatch = /^(?:([a-zA-Z0-9_]+)\s*\.\s*)?"?([a-zA-Z0-9_]+)"?$/.exec(
        exprWithoutCast
      );

      const aliasStartInSlice =
        explicitAsMatch.index + explicitAsMatch[0].lastIndexOf(aliasName);
      const absStart = span.start + aliasStartInSlice;
      const absEnd = absStart + aliasName.length;

      projections.push({
        kind: 'column',
        name: aliasName,
        qualifier: directSourceMatch?.[1],
        sourceColumn: directSourceMatch?.[2],
        inferredType,
        location: filePath
          ? offsetRangeToSourceLocation(sanitizedSql, filePath, absStart, absEnd)
          : undefined,
      });
      continue;
    }

    // Unaliased column (with optional qualifier and optional trailing ::TYPE cast)
    const inferredType = inferTypeFromRawProjection(rawSlice);
    const withoutCast = rawSlice.replace(TRAILING_CAST_TYPE_REGEX, (m) => ' '.repeat(m.length));
    const trailingColMatch = /(?:([a-zA-Z0-9_]+)\s*\.\s*)?"?([a-zA-Z0-9_]+)"?\s*$/.exec(
      withoutCast
    );

    if (trailingColMatch && trailingColMatch[2]) {
      const colName = trailingColMatch[2];
      if (
        SYNTHETIC_JINJA_ID_REGEX.test(colName) ||
        NON_COLUMN_TRAILING_KEYWORDS.has(colName.toLowerCase())
      ) {
        continue;
      }

      const colStartInSlice =
        trailingColMatch.index + trailingColMatch[0].lastIndexOf(colName);
      const absStart = span.start + colStartInSlice;
      const absEnd = absStart + colName.length;

      projections.push({
        kind: 'column',
        name: colName,
        qualifier: trailingColMatch[1],
        sourceColumn: colName,
        inferredType,
        location: filePath
          ? offsetRangeToSourceLocation(sanitizedSql, filePath, absStart, absEnd)
          : undefined,
      });
    }
  }

  return projections;
}

/**
 * Dialect-agnostic scanner that extracts table/model/CTE relations and aliases
 * declared in top-level FROM and JOIN clauses of a query block.
 */
export function scanFromJoinRelations(
  sanitizedSql: string,
  blockStartOffset: number,
  blockEndOffset: number,
  relations: Map<string, DbtRelationToken>
): ScannedFromRelation[] {
  const cleanSql = maskCommentsAndStrings(sanitizedSql);
  const found: ScannedFromRelation[] = [];

  let depth = 0;
  let i = blockStartOffset;
  const limit = Math.min(blockEndOffset, cleanSql.length);

  while (i < limit) {
    const ch = cleanSql[i];
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (depth === 0) {
      const prevChar = i > blockStartOffset ? (cleanSql[i - 1] ?? ' ') : ' ';
      if (!/[a-zA-Z0-9_]/.test(prevChar)) {
        const slice = cleanSql.slice(i, limit);
        const clauseMatch =
          /^(?:FROM|JOIN)\s+([a-zA-Z0-9_.]+)(?:[ \t\r\n]+(?:AS[ \t\r\n]+)?([a-zA-Z0-9_]+))?/i.exec(
            slice
          );

        if (clauseMatch && clauseMatch[1]) {
          const rawTableToken = clauseMatch[1];
          const rawCandidateAlias = clauseMatch[2];

          const dbtRel = relations.get(rawTableToken.toLowerCase());
          const targetName =
            dbtRel?.modelOrTableName ?? rawTableToken.split('.').pop() ?? rawTableToken;

          const hasValidAlias =
            Boolean(rawCandidateAlias) &&
            !SQL_CLAUSE_RESERVED_WORDS.has(rawCandidateAlias!.toLowerCase()) &&
            !SYNTHETIC_JINJA_ID_REGEX.test(rawCandidateAlias!);

          found.push({
            aliasOrName: hasValidAlias && rawCandidateAlias ? rawCandidateAlias : targetName,
            targetName,
            isDbtSource: dbtRel?.type === 'source',
          });

          if (hasValidAlias && rawCandidateAlias) {
            i += clauseMatch[0].length;
          } else {
            const tableEndInSlice =
              clauseMatch[0].indexOf(rawTableToken) + rawTableToken.length;
            i += tableEndInSlice;
          }
          continue;
        }
      }
    }

    i++;
  }

  return found;
}