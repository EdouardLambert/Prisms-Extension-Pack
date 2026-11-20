// packages/dbt-prism/tests/core/analyzer/sqlTypeInferrer.test.ts

import { describe, expect, it } from 'vitest';
import { MetadataRegistryPort, ModelDescriptor } from '@prism/core';
import { SqlScopeAnalyzer } from '../../../src/core/analyzer/sqlScopeAnalyzer.js';
import { unifySqlTypes } from '../../../src/core/analyzer/sqlTypeInferrer.js';

function createMockRegistry(models: ModelDescriptor[]): MetadataRegistryPort {
  const map = new Map<string, ModelDescriptor>();
  for (const m of models) {
    map.set(m.name.toLowerCase(), m);
  }
  return {
    getModel: (name: string) => map.get(name.toLowerCase()),
    getAllModels: () => Array.from(map.values()),
  };
}

describe('unifySqlTypes', () => {
  it('returns identical type when all branches match', () => {
    expect(unifySqlTypes(['VARCHAR(30)', 'VARCHAR(30)'])).toBe('VARCHAR(30)');
    expect(unifySqlTypes(['BOOLEAN', 'BOOLEAN'])).toBe('BOOLEAN');
  });

  it('promotes compatible numeric, string, and temporal types', () => {
    expect(unifySqlTypes(['VARCHAR(30)', 'VARCHAR'])).toBe('VARCHAR');
    expect(unifySqlTypes(['INTEGER', 'BIGINT'])).toBe('BIGINT');
    expect(unifySqlTypes(['INTEGER', 'DOUBLE'])).toBe('DOUBLE');
    expect(unifySqlTypes(['DECIMAL(18, 2)', 'INTEGER'])).toBe('DECIMAL(18, 2)');
    expect(unifySqlTypes(['DATE', 'TIMESTAMP'])).toBe('TIMESTAMP');
  });

  it('ignores unresolved branches when remaining known branches are compatible', () => {
    expect(unifySqlTypes([undefined, 'VARCHAR'])).toBe('VARCHAR');
    expect(unifySqlTypes([undefined, 'INTEGER', 'BIGINT'])).toBe('BIGINT');
  });

  it('returns undefined when known branches conflict across incompatible families', () => {
    expect(unifySqlTypes(['INTEGER', 'TIMESTAMP'])).toBeUndefined();
    expect(unifySqlTypes(['VARCHAR', 'DATE'])).toBeUndefined();
    expect(unifySqlTypes(['BOOLEAN', 'INTEGER'])).toBeUndefined();
    expect(unifySqlTypes([undefined, undefined])).toBeUndefined();
  });
});

describe('SqlScopeAnalyzer recursive expression type inference', () => {
  const registry = createMockRegistry([
    {
      name: 'table_a',
      filePath: '/models/silver/table_a.sql',
      materialized: 'incremental',
      refs: [],
      lastUpdated: Date.now(),
      columns: new Map([
        ['sub', { name: 'sub', dataType: 'VARCHAR', origin: 'schema_yml', sourceModelName: 'table_a' }],
        ['event_date', { name: 'event_date', dataType: 'DATE', origin: 'schema_yml', sourceModelName: 'table_a' }],
        ['start_ts', { name: 'start_ts', dataType: 'TIMESTAMP', origin: 'schema_yml', sourceModelName: 'table_a' }],
        ['amount', { name: 'amount', dataType: 'DOUBLE', origin: 'schema_yml', sourceModelName: 'table_a' }],
        ['untyped_col', { name: 'untyped_col', origin: 'sql_inferred', sourceModelName: 'table_a' }],
      ]),
    },
  ]);

  const analyzer = new SqlScopeAnalyzer(registry);

  it('infers booleans, deterministic functions, COALESCE, NULLIF, and homogeneous CASE expressions', () => {
    const sql = `
      SELECT
        a.sub IS NOT NULL AS has_sub,
        concat(coalesce(a.sub, 'N/A'), ' ', 'ok') AS full_label,
        coalesce(a.untyped_col, 'N/A') AS fallback_label,
        coalesce(a.amount, 0) AS safe_amount,
        nullif(sum(coalesce(a.amount, 0)), 0) AS net_total,
        regexp_extract(a.sub, '([a-f0-9]{32})', 1) AS clean_hash,
        CASE
          WHEN a.event_date IS NULL THEN NULL
          WHEN a.amount > 10 THEN 'high'
          ELSE 'low'
        END AS bucket,
        CASE
          WHEN a.event_date < a.start_ts THEN datediff('day', a.event_date, a.start_ts)
        END AS day_delta,
        a.event_date + 7 AS next_week
      FROM {{ ref('table_a') }} AS a
    `;

    const { columns } = analyzer.inferModelColumns(sql, 'gold_test', 'table');
    const byName = new Map(columns.map((c) => [c.name, c.dataType]));

    expect(byName.get('has_sub')).toBe('BOOLEAN');
    expect(byName.get('full_label')).toBe('VARCHAR');
    expect(byName.get('fallback_label')).toBe('VARCHAR');
    expect(byName.get('safe_amount')).toBe('DOUBLE');
    expect(byName.get('net_total')).toBe('NUMERIC');
    expect(byName.get('clean_hash')).toBe('VARCHAR');
    expect(byName.get('bucket')).toBe('VARCHAR');
    expect(byName.get('day_delta')).toBe('BIGINT');
    expect(byName.get('next_week')).toBe('DATE');
  });

  it('falls back to undefined (UNKNOWN) when CASE or COALESCE branches conflict', () => {
    const sql = `
      SELECT
        CASE
          WHEN a.amount > 0 THEN a.event_date
          ELSE a.amount
        END AS conflicting_case,
        coalesce(a.amount, 'N/A') AS conflicting_coalesce
      FROM {{ ref('table_a') }} AS a
    `;

    const { columns } = analyzer.inferModelColumns(sql, 'gold_conflict', 'table');
    const byName = new Map(columns.map((c) => [c.name, c.dataType]));

    expect(byName.get('conflicting_case')).toBeUndefined();
    expect(byName.get('conflicting_coalesce')).toBeUndefined();
  });

  it('prefers explicit casts over inner expression types', () => {
    const sql = `
      SELECT
        coalesce(a.sub, 'N/A')::VARCHAR(30) AS casted_label,
        CASE WHEN a.amount > 0 THEN 'yes' ELSE 'no' END::VARCHAR(10) AS casted_case
      FROM {{ ref('table_a') }} AS a
    `;

    const { columns } = analyzer.inferModelColumns(sql, 'gold_cast', 'table');
    const byName = new Map(columns.map((c) => [c.name, c.dataType]));

    expect(byName.get('casted_label')).toBe('VARCHAR(30)');
    expect(byName.get('casted_case')).toBe('VARCHAR(10)');
  });
});

describe('SqlScopeAnalyzer Go-to-Definition on function and CASE aliases', () => {
  const col4Loc = { filePath: '/models/silver/table_m.sql', line: 4, startColumn: 4, endColumn: 9 };
  const col6Loc = { filePath: '/models/silver/table_m.sql', line: 6, startColumn: 4, endColumn: 9 };

  const registry = createMockRegistry([
    {
      name: 'table_m',
      filePath: '/models/silver/table_m.sql',
      materialized: 'table',
      refs: [],
      lastUpdated: Date.now(),
      columns: new Map([
        ['col_4', { name: 'col_4', dataType: 'VARCHAR', origin: 'sql_inferred', sourceModelName: 'table_m', definitionLocation: col4Loc }],
        ['col_6', { name: 'col_6', dataType: 'VARCHAR', origin: 'sql_inferred', sourceModelName: 'table_m', definitionLocation: col6Loc }],
      ]),
    },
  ]);

  const analyzer = new SqlScopeAnalyzer(registry);

  it('redirects when COALESCE or CASE references a single unique column', () => {
    const sql = `
      SELECT
        coalesce(m.col_4, 'N/A') AS single_coalesce,
        CASE
          WHEN m.col_4 = 'a' THEN 'cat_1'
          WHEN m.col_4 = 'b' THEN 'cat_2'
          ELSE 'cat_3'
        END AS single_case
      FROM {{ ref('table_m') }} AS m
    `;

    expect(analyzer.computeDefinition(sql, sql.indexOf('single_coalesce') + 2)).toEqual(col4Loc);
    expect(analyzer.computeDefinition(sql, sql.indexOf('single_case') + 2)).toEqual(col4Loc);
  });

  it('returns null when COALESCE or CASE references multiple distinct columns', () => {
    const sql = `
      SELECT
        coalesce(m.col_4, m.col_6) AS multi_coalesce,
        coalesce(m.col_4, m.col_6) AS col_4,
        CASE
          WHEN m.col_4 = 'a' THEN m.col_6
          ELSE 'N/A'
        END AS multi_case
      FROM {{ ref('table_m') }} AS m
    `;

    expect(analyzer.computeDefinition(sql, sql.indexOf('multi_coalesce') + 2)).toBeNull();
    expect(analyzer.computeDefinition(sql, sql.indexOf('AS col_4') + 4)).toBeNull();
    expect(analyzer.computeDefinition(sql, sql.indexOf('multi_case') + 2)).toBeNull();
  });
});