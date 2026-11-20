// packages/dbt-prism/src/core/analyzer/sqlTypeInferrer.ts

export interface TypeLookupColumn {
  name: string;
  dataType?: string;
}

export interface TypeLookupRelation {
  columns: ReadonlyArray<TypeLookupColumn>;
}

const NULL_SENTINEL = '__NULL_LITERAL__';

const BOOLEAN_BINARY_OPERATORS = new Set([
  '=',
  '==',
  '!=',
  '<>',
  '<',
  '>',
  '<=',
  '>=',
  'IS',
  'IS NOT',
  'IN',
  'NOT IN',
  'BETWEEN',
  'NOT BETWEEN',
  'LIKE',
  'NOT LIKE',
  'ILIKE',
  'NOT ILIKE',
  'SIMILAR TO',
  'NOT SIMILAR TO',
  'AND',
  'OR',
  '~',
  '~*',
  '!~',
  '!~*',
]);

const ARITHMETIC_OPERATORS = new Set(['+', '-', '*', '/', '%']);

const FIXED_RETURN_TYPE_FUNCTIONS: Record<string, string> = {
  // String functions
  CONCAT: 'VARCHAR',
  CONCAT_WS: 'VARCHAR',
  UPPER: 'VARCHAR',
  LOWER: 'VARCHAR',
  TRIM: 'VARCHAR',
  LTRIM: 'VARCHAR',
  RTRIM: 'VARCHAR',
  BTRIM: 'VARCHAR',
  SUBSTR: 'VARCHAR',
  SUBSTRING: 'VARCHAR',
  LEFT: 'VARCHAR',
  RIGHT: 'VARCHAR',
  REPLACE: 'VARCHAR',
  REGEXP_REPLACE: 'VARCHAR',
  REGEXP_EXTRACT: 'VARCHAR',
  SPLIT_PART: 'VARCHAR',
  LPAD: 'VARCHAR',
  RPAD: 'VARCHAR',
  REVERSE: 'VARCHAR',
  CHR: 'VARCHAR',
  MD5: 'VARCHAR',
  SHA256: 'VARCHAR',
  PRINTF: 'VARCHAR',
  FORMAT: 'VARCHAR',
  STRFTIME: 'VARCHAR',
  TO_CHAR: 'VARCHAR',
  STRING_AGG: 'VARCHAR',
  LISTAGG: 'VARCHAR',
  GROUP_CONCAT: 'VARCHAR',
  JSON_EXTRACT_STRING: 'VARCHAR',

  // Integer / count / window functions
  COUNT: 'BIGINT',
  ROW_NUMBER: 'BIGINT',
  RANK: 'BIGINT',
  DENSE_RANK: 'BIGINT',
  NTILE: 'BIGINT',
  LENGTH: 'BIGINT',
  CHAR_LENGTH: 'BIGINT',
  CHARACTER_LENGTH: 'BIGINT',
  OCTET_LENGTH: 'BIGINT',
  LEN: 'BIGINT',
  STRPOS: 'BIGINT',
  POSITION: 'BIGINT',
  INSTR: 'BIGINT',
  DATEDIFF: 'BIGINT',
  DATE_DIFF: 'BIGINT',
  DATE_PART: 'BIGINT',
  EXTRACT: 'BIGINT',
  YEAR: 'BIGINT',
  MONTH: 'BIGINT',
  DAY: 'BIGINT',
  HOUR: 'BIGINT',
  MINUTE: 'BIGINT',
  SECOND: 'BIGINT',
  EPOCH: 'BIGINT',
  EPOCH_MS: 'BIGINT',
  SIGN: 'INTEGER',
  ASCII: 'INTEGER',
  ARRAY_LENGTH: 'BIGINT',
  LIST_COUNT: 'BIGINT',

  // Numeric / floating-point functions
  SUM: 'NUMERIC',
  AVG: 'NUMERIC',
  STDDEV: 'DOUBLE',
  STDDEV_POP: 'DOUBLE',
  STDDEV_SAMP: 'DOUBLE',
  VARIANCE: 'DOUBLE',
  VAR_POP: 'DOUBLE',
  VAR_SAMP: 'DOUBLE',
  PERCENT_RANK: 'DOUBLE',
  CUME_DIST: 'DOUBLE',
  LN: 'DOUBLE',
  LOG: 'DOUBLE',
  LOG10: 'DOUBLE',
  EXP: 'DOUBLE',
  SQRT: 'DOUBLE',
  POW: 'DOUBLE',
  POWER: 'DOUBLE',
  RANDOM: 'DOUBLE',

  // Temporal functions
  CURRENT_DATE: 'DATE',
  TODAY: 'DATE',
  MAKE_DATE: 'DATE',
  TO_DATE: 'DATE',
  CURRENT_TIMESTAMP: 'TIMESTAMP',
  NOW: 'TIMESTAMP',
  GETDATE: 'TIMESTAMP',
  LOCALTIMESTAMP: 'TIMESTAMP',
  MAKE_TIMESTAMP: 'TIMESTAMP',
  TO_TIMESTAMP: 'TIMESTAMP',
  STRPTIME: 'TIMESTAMP',
  CURRENT_TIME: 'TIME',
  LOCALTIME: 'TIME',
  MAKE_TIME: 'TIME',

  // Boolean functions
  REGEXP_MATCHES: 'BOOLEAN',
  REGEXP_FULL_MATCH: 'BOOLEAN',
  CONTAINS: 'BOOLEAN',
  STARTS_WITH: 'BOOLEAN',
  ENDS_WITH: 'BOOLEAN',
  ISNAN: 'BOOLEAN',
  ISINF: 'BOOLEAN',
  ISFINITE: 'BOOLEAN',
  BOOL_AND: 'BOOLEAN',
  BOOL_OR: 'BOOLEAN',
  EVERY: 'BOOLEAN',
};

const UNIFY_ALL_ARGS_FUNCTIONS = new Set([
  'COALESCE',
  'IFNULL',
  'NVL',
  'LEAST',
  'GREATEST',
]);

const PROPAGATE_FIRST_ARG_FUNCTIONS = new Set([
  'NULLIF',
  'MIN',
  'MAX',
  'ANY_VALUE',
  'FIRST',
  'LAST',
  'FIRST_VALUE',
  'LAST_VALUE',
  'LAG',
  'LEAD',
  'NTH_VALUE',
  'ABS',
  'ROUND',
  'CEIL',
  'CEILING',
  'FLOOR',
  'TRUNC',
]);

type TypeFamily =
  | 'string'
  | 'numeric'
  | 'boolean'
  | 'temporal'
  | 'time'
  | 'interval'
  | 'uuid'
  | 'json'
  | 'binary'
  | 'other';

interface NormalizedTypeInfo {
  raw: string;
  base: string;
  family: TypeFamily;
  rank: number;
}

/**
 * Recursively infers the deterministic SQL output data type of a node-sql-parser AST expression.
 * Returns `undefined` when the type cannot be reliably determined or when branches conflict.
 */
export function inferExpressionDataType(
  expr: any,
  scopedRelations: ReadonlyMap<string, TypeLookupRelation> = new Map()
): string | undefined {
  const inferred = inferNodeType(expr, scopedRelations);
  if (!inferred || inferred === NULL_SENTINEL) {
    return undefined;
  }
  return inferred;
}

function inferNodeType(
  expr: any,
  scopedRelations: ReadonlyMap<string, TypeLookupRelation>
): string | undefined {
  if (!expr || typeof expr !== 'object') return undefined;

  // 1. Explicit CAST / ::TYPE
  if (expr.type === 'cast') {
    const target = Array.isArray(expr.target) ? expr.target[0] : expr.target;
    if (typeof target?.dataType === 'string') {
      const baseType = target.dataType.toUpperCase();
      if (typeof target.length === 'number') {
        const suffix =
          typeof target.scale === 'number'
            ? `(${target.length}, ${target.scale})`
            : `(${target.length})`;
        return `${baseType}${suffix}`;
      }
      return baseType;
    }
    return undefined;
  }

  // 2. Literals
  if (
    expr.type === 'single_quote_string' ||
    expr.type === 'string' ||
    expr.type === 'double_quote_string'
  ) {
    return 'VARCHAR';
  }
  if (expr.type === 'number') {
    if (typeof expr.value === 'number') {
      return Number.isInteger(expr.value) ? 'INTEGER' : 'DOUBLE';
    }
    return 'NUMERIC';
  }
  if (expr.type === 'bool') {
    return 'BOOLEAN';
  }
  if (expr.type === 'null') {
    return NULL_SENTINEL;
  }
  if (expr.type === 'interval') {
    return 'INTERVAL';
  }

  // 3. Parenthesized expression list with a single item
  if (expr.type === 'expr_list' && Array.isArray(expr.value) && expr.value.length === 1) {
    return inferNodeType(expr.value[0], scopedRelations);
  }

  // 4. Column reference
  if (expr.type === 'column_ref') {
    return lookupColumnType(expr, scopedRelations);
  }

  // 5. EXTRACT(... FROM ...)
  if (expr.type === 'extract') {
    return 'BIGINT';
  }

  // 6. Unary expressions
  if (expr.type === 'unary_expr') {
    const op = typeof expr.operator === 'string' ? expr.operator.trim().toUpperCase() : '';
    if (op === 'NOT') return 'BOOLEAN';
    if (op === '-' || op === '+') {
      return inferNodeType(expr.expr, scopedRelations);
    }
    return undefined;
  }

  // 7. Binary expressions
  if (expr.type === 'binary_expr') {
    const op = typeof expr.operator === 'string' ? expr.operator.trim().toUpperCase() : '';
    if (BOOLEAN_BINARY_OPERATORS.has(op)) {
      return 'BOOLEAN';
    }
    if (op === '||') {
      return 'VARCHAR';
    }
    if (ARITHMETIC_OPERATORS.has(op)) {
      return inferArithmeticType(op, expr.left, expr.right, scopedRelations);
    }
    return undefined;
  }

  // 8. CASE WHEN ... THEN ... ELSE ... END
  if (expr.type === 'case' && Array.isArray(expr.args)) {
    const branchTypes: Array<string | undefined> = [];
    for (const branch of expr.args) {
      if (branch && typeof branch === 'object' && 'result' in branch) {
        branchTypes.push(inferNodeType(branch.result, scopedRelations));
      }
    }
    return unifySqlTypes(branchTypes);
  }

  // 9. Aggregate functions and scalar/window functions
  if (expr.type === 'aggr_func' || expr.type === 'function') {
    const funcName = extractFunctionName(expr);
    if (!funcName) return undefined;

    if (funcName in FIXED_RETURN_TYPE_FUNCTIONS) {
      return FIXED_RETURN_TYPE_FUNCTIONS[funcName];
    }

    const args = extractFunctionArgs(expr);

    if (UNIFY_ALL_ARGS_FUNCTIONS.has(funcName)) {
      return unifySqlTypes(args.map((arg) => inferNodeType(arg, scopedRelations)));
    }

    if (PROPAGATE_FIRST_ARG_FUNCTIONS.has(funcName)) {
      return args.length > 0 ? inferNodeType(args[0], scopedRelations) : undefined;
    }

    if (funcName === 'IF' || funcName === 'IFF') {
      return unifySqlTypes(args.slice(1, 3).map((arg) => inferNodeType(arg, scopedRelations)));
    }

    if (funcName === 'DATE_TRUNC') {
      const targetType = args.length >= 2 ? inferNodeType(args[1], scopedRelations) : undefined;
      return targetType && targetType !== NULL_SENTINEL ? targetType : 'TIMESTAMP';
    }

    if (funcName === 'DATE_ADD' || funcName === 'DATE_SUB') {
      return args.length > 0 ? inferNodeType(args[0], scopedRelations) : undefined;
    }

    return undefined;
  }

  return undefined;
}

function inferArithmeticType(
  operator: string,
  leftNode: any,
  rightNode: any,
  scopedRelations: ReadonlyMap<string, TypeLookupRelation>
): string {
  if (operator === '+' || operator === '-') {
    const leftType = inferNodeType(leftNode, scopedRelations);
    const rightType = inferNodeType(rightNode, scopedRelations);
    const leftInfo = leftType && leftType !== NULL_SENTINEL ? classifySqlType(leftType) : undefined;
    const rightInfo =
      rightType && rightType !== NULL_SENTINEL ? classifySqlType(rightType) : undefined;

    if (leftInfo?.family === 'temporal' || rightInfo?.family === 'temporal') {
      if (leftInfo?.family === 'temporal' && rightInfo?.family === 'temporal' && operator === '-') {
        return leftInfo.rank === 1 && rightInfo.rank === 1 ? 'BIGINT' : 'INTERVAL';
      }
      if (leftInfo?.family === 'interval' || rightInfo?.family === 'interval') {
        const temporalInfo = leftInfo?.family === 'temporal' ? leftInfo : rightInfo!;
        return temporalInfo.rank >= 3 ? temporalInfo.raw : 'TIMESTAMP';
      }
      if (leftInfo?.family === 'temporal' && rightInfo?.family === 'numeric') {
        return leftInfo.raw;
      }
      if (rightInfo?.family === 'temporal' && leftInfo?.family === 'numeric') {
        return rightInfo.raw;
      }
    }
  }

  return 'NUMERIC';
}

/**
 * Unifies multiple candidate SQL types (e.g. from CASE branches or COALESCE arguments).
 * - Ignores NULL literals and unresolved branches as long as at least one type is known.
 * - Promotes compatible types within the same family (e.g. INTEGER + DOUBLE -> DOUBLE).
 * - Returns `undefined` if two known types belong to incompatible families (e.g. DATE vs INTEGER).
 */
export function unifySqlTypes(types: ReadonlyArray<string | undefined>): string | undefined {
  const knownTypes = types.filter(
    (t): t is string => typeof t === 'string' && t.length > 0 && t !== NULL_SENTINEL
  );

  if (knownTypes.length === 0) {
    return undefined;
  }

  const classified = knownTypes.map(classifySqlType);
  const first = classified[0]!;

  for (let i = 1; i < classified.length; i++) {
    const current = classified[i]!;
    if (current.family !== first.family) {
      return undefined;
    }
    if (current.family === 'other' && current.base !== first.base) {
      return undefined;
    }
  }

  // All types are identical (case-insensitive)
  if (classified.every((info) => info.raw.toUpperCase() === first.raw.toUpperCase())) {
    return first.raw;
  }

  if (first.family === 'string') {
    return 'VARCHAR';
  }

  if (first.family === 'boolean') {
    return 'BOOLEAN';
  }

  if (first.family === 'numeric' || first.family === 'temporal') {
    let widest = first;
    let hasDifferentSameRank = false;

    for (let i = 1; i < classified.length; i++) {
      const current = classified[i]!;
      if (current.rank > widest.rank) {
        widest = current;
        hasDifferentSameRank = false;
      } else if (
        current.rank === widest.rank &&
        current.raw.toUpperCase() !== widest.raw.toUpperCase()
      ) {
        hasDifferentSameRank = true;
      }
    }

    if (hasDifferentSameRank && first.family === 'numeric' && widest.rank === 6) {
      return 'NUMERIC';
    }
    return widest.raw;
  }

  return first.raw;
}

function classifySqlType(rawType: string): NormalizedTypeInfo {
  const trimmed = rawType.trim().toUpperCase();
  const base = trimmed
    .replace(/\(.*\)$/, '')
    .replace(/\[\]$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    base === 'VARCHAR' ||
    base === 'TEXT' ||
    base === 'STRING' ||
    base === 'CHAR' ||
    base === 'CHARACTER' ||
    base === 'CHARACTER VARYING' ||
    base === 'BPCHAR' ||
    base === 'NVARCHAR'
  ) {
    return { raw: trimmed, base, family: 'string', rank: 1 };
  }

  if (base === 'BOOL' || base === 'BOOLEAN') {
    return { raw: trimmed, base, family: 'boolean', rank: 1 };
  }

  if (base === 'TINYINT' || base === 'UTINYINT') {
    return { raw: trimmed, base, family: 'numeric', rank: 1 };
  }
  if (base === 'SMALLINT' || base === 'INT2' || base === 'USMALLINT') {
    return { raw: trimmed, base, family: 'numeric', rank: 2 };
  }
  if (base === 'INT' || base === 'INTEGER' || base === 'INT4' || base === 'UINTEGER') {
    return { raw: trimmed, base, family: 'numeric', rank: 3 };
  }
  if (base === 'BIGINT' || base === 'INT8' || base === 'UBIGINT') {
    return { raw: trimmed, base, family: 'numeric', rank: 4 };
  }
  if (base === 'HUGEINT' || base === 'UHUGEINT') {
    return { raw: trimmed, base, family: 'numeric', rank: 5 };
  }
  if (base === 'NUMERIC' || base === 'DECIMAL' || base === 'NUMBER') {
    return { raw: trimmed, base, family: 'numeric', rank: 6 };
  }
  if (base === 'REAL' || base === 'FLOAT' || base === 'FLOAT4') {
    return { raw: trimmed, base, family: 'numeric', rank: 7 };
  }
  if (base === 'DOUBLE' || base === 'DOUBLE PRECISION' || base === 'FLOAT8') {
    return { raw: trimmed, base, family: 'numeric', rank: 8 };
  }

  if (base === 'DATE') {
    return { raw: trimmed, base, family: 'temporal', rank: 1 };
  }
  if (
    base === 'TIMESTAMP' ||
    base === 'DATETIME' ||
    base === 'TIMESTAMP WITHOUT TIME ZONE' ||
    base === 'TIMESTAMP_S' ||
    base === 'TIMESTAMP_MS' ||
    base === 'TIMESTAMP_NS'
  ) {
    return { raw: trimmed, base, family: 'temporal', rank: 2 };
  }
  if (base === 'TIMESTAMPTZ' || base === 'TIMESTAMP WITH TIME ZONE') {
    return { raw: trimmed, base, family: 'temporal', rank: 3 };
  }

  if (base === 'TIME' || base === 'TIMETZ' || base === 'TIME WITH TIME ZONE') {
    return { raw: trimmed, base, family: 'time', rank: 1 };
  }
  if (base === 'INTERVAL') {
    return { raw: trimmed, base, family: 'interval', rank: 1 };
  }
  if (base === 'UUID') {
    return { raw: trimmed, base, family: 'uuid', rank: 1 };
  }
  if (base === 'JSON' || base === 'JSONB') {
    return { raw: trimmed, base, family: 'json', rank: 1 };
  }
  if (base === 'BLOB' || base === 'BYTEA' || base === 'BINARY' || base === 'VARBINARY') {
    return { raw: trimmed, base, family: 'binary', rank: 1 };
  }

  return { raw: trimmed, base, family: 'other', rank: 1 };
}

function lookupColumnType(
  colRefNode: any,
  scopedRelations: ReadonlyMap<string, TypeLookupRelation>
): string | undefined {
  const colName = unwrapNodeIdentifier(colRefNode?.column)?.toLowerCase();
  if (!colName || colName === '*') return undefined;

  const tableQual = unwrapNodeIdentifier(colRefNode?.table)?.toLowerCase();
  if (tableQual) {
    const rel = scopedRelations.get(tableQual);
    return rel?.columns.find((c) => c.name.toLowerCase() === colName)?.dataType;
  }

  for (const rel of scopedRelations.values()) {
    const found = rel.columns.find((c) => c.name.toLowerCase() === colName);
    if (found?.dataType) return found.dataType;
  }

  return undefined;
}

function extractFunctionName(expr: any): string | undefined {
  const rawName = expr?.name;
  if (typeof rawName === 'string') {
    return rawName.trim().toUpperCase();
  }
  if (rawName && typeof rawName === 'object') {
    if (Array.isArray(rawName.name) && rawName.name.length > 0) {
      const lastPart = rawName.name[rawName.name.length - 1];
      if (typeof lastPart?.value === 'string') {
        return lastPart.value.trim().toUpperCase();
      }
      if (typeof lastPart === 'string') {
        return lastPart.trim().toUpperCase();
      }
    }
    if (typeof rawName.value === 'string') {
      return rawName.value.trim().toUpperCase();
    }
  }
  return undefined;
}

function extractFunctionArgs(expr: any): any[] {
  const rawArgs = expr?.args;
  if (!rawArgs) return [];
  if (Array.isArray(rawArgs)) return rawArgs;
  if (Array.isArray(rawArgs.value)) return rawArgs.value;
  if (rawArgs.expr) return [rawArgs.expr];
  return [];
}

function unwrapNodeIdentifier(node: any): string | undefined {
  if (!node) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node.value === 'string') return node.value;
  if (typeof node.expr?.value === 'string') return node.expr.value;
  return undefined;
}