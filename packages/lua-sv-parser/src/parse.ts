import luaparse from 'luaparse';
import type { Chunk, Expression, Node, TableConstructorExpression } from 'luaparse';

/** A Lua table converted to JS: a 1..n sequence becomes an array, anything else a null-prototype object. */
export type LuaValue = string | number | boolean | LuaValue[] | LuaTable;
export interface LuaTable {
  [key: string]: LuaValue;
}

export type ParseErrorReason = 'syntax' | 'truncated' | 'unsupported' | 'too-deep';

export class SavedVariablesParseError extends Error {
  readonly reason: ParseErrorReason;
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(reason: ParseErrorReason, message: string, line?: number, column?: number) {
    super(line === undefined ? message : `${message} (line ${line}, column ${column ?? 0})`);
    this.name = 'SavedVariablesParseError';
    this.reason = reason;
    this.line = line;
    this.column = column;
  }
}

export interface ParseOptions {
  /** Maximum table nesting depth. SavedVariables written by WoW are rarely deeper than ~15. */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 64;

/**
 * Parse a WoW SavedVariables file into plain JS values.
 *
 * The file is parsed to an AST and only table constructors and literals are accepted. Nothing is ever
 * evaluated: a function call, variable reference or any other expression is rejected.
 *
 * Pass the raw file bytes (Buffer) when you have them; a JS string is treated as already UTF-8 decoded.
 * Returns one entry per top-level assignment, e.g. `{ ForeverLedgerDB: {...} }`.
 */
export function parseSavedVariables(
  input: Buffer | Uint8Array | string,
  options: ParseOptions = {},
) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  // luaparse's pseudo-latin1 mode wants each source byte as one char; string values come back as byte strings.
  const source = bytes.toString('latin1');
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  let chunk: Chunk;
  try {
    chunk = luaparse.parse(source, {
      luaVersion: '5.1',
      encodingMode: 'pseudo-latin1',
      comments: false,
      locations: true,
      scope: false,
    });
  } catch (err) {
    throw toParseError(err, source);
  }

  const out: LuaTable = Object.create(null) as LuaTable;
  for (const statement of chunk.body) {
    if (statement.type !== 'AssignmentStatement') {
      throw unsupported(statement, `top-level ${statement.type} is not allowed`);
    }
    statement.variables.forEach((variable, i) => {
      if (variable.type !== 'Identifier') {
        throw unsupported(variable, `assignment target ${variable.type} is not allowed`);
      }
      const init = statement.init[i];
      if (init === undefined) return;
      const value = convert(init, 0, maxDepth);
      if (value === null) delete out[variable.name];
      else setKey(out, variable.name, value);
    });
  }
  return out;
}

/** Converts a literal/table expression; returns null for `nil`. */
function convert(node: Expression, depth: number, maxDepth: number): LuaValue | null {
  switch (node.type) {
    case 'StringLiteral':
      return decodeString(node.value);
    case 'NumericLiteral':
      return node.value;
    case 'BooleanLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral')
        return -node.argument.value;
      throw unsupported(node, `unary '${node.operator}' is only allowed on numbers`);
    case 'TableConstructorExpression':
      if (depth >= maxDepth) {
        throw new SavedVariablesParseError(
          'too-deep',
          `tables nested deeper than ${maxDepth}`,
          node.loc?.start.line,
          node.loc?.start.column,
        );
      }
      return convertTable(node, depth + 1, maxDepth);
    default:
      throw unsupported(node, `${node.type} is not allowed in SavedVariables`);
  }
}

function convertTable(node: TableConstructorExpression, depth: number, maxDepth: number): LuaValue {
  // Lua semantics: positional fields are numbered 1.. in order and win over explicit keys at the same index.
  const entries = new Map<string | number, LuaValue>();
  let position = 0;
  for (const field of node.fields) {
    let key: string | number;
    if (field.type === 'TableValue') {
      key = ++position;
    } else if (field.type === 'TableKeyString') {
      key = field.key.name;
    } else {
      const k = convert(field.key, depth, maxDepth);
      if (typeof k === 'string' || typeof k === 'number') key = k;
      else if (typeof k === 'boolean') key = String(k);
      else throw unsupported(field.key, 'table keys must be strings, numbers or booleans');
    }
    const value = convert(field.value, depth, maxDepth);
    if (value === null) entries.delete(key);
    else entries.set(key, value);
  }

  if (entries.size > 0 && isSequence(entries)) {
    const arr: LuaValue[] = new Array<LuaValue>(entries.size);
    for (const [k, v] of entries) arr[(k as number) - 1] = v;
    return arr;
  }
  const obj = Object.create(null) as LuaTable;
  for (const [k, v] of entries) setKey(obj, String(k), v);
  return obj;
}

function isSequence(entries: Map<string | number, LuaValue>): boolean {
  for (const k of entries.keys()) {
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > entries.size) return false;
  }
  return true;
}

function setKey(obj: LuaTable, key: string, value: LuaValue) {
  // Null-prototype objects make "__proto__" an ordinary key; define it explicitly to be safe anyway.
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function decodeString(value: string | null): string {
  // pseudo-latin1: one char per byte. WoW writes UTF-8, so reassemble the bytes.
  return Buffer.from(value ?? '', 'latin1').toString('utf8');
}

function unsupported(node: Node, message: string) {
  return new SavedVariablesParseError(
    'unsupported',
    message,
    node.loc?.start.line,
    node.loc?.start.column,
  );
}

function toParseError(err: unknown, source: string): SavedVariablesParseError {
  if (err instanceof RangeError) {
    return new SavedVariablesParseError('too-deep', 'input nested too deeply to parse');
  }
  if (err instanceof SyntaxError) {
    const e = err as SyntaxError & { line?: number; column?: number; index?: number };
    // A half-written file ends mid-table or mid-string, so luaparse fails at (or past) the end of the input.
    const atEnd = /<eof>/.test(e.message) || (e.index ?? 0) >= source.trimEnd().length;
    const reason: ParseErrorReason = atEnd ? 'truncated' : 'syntax';
    const message = e.message.replace(/^\[\d+:\d+\]\s*/, '');
    return new SavedVariablesParseError(reason, message, e.line, e.column);
  }
  return new SavedVariablesParseError('syntax', err instanceof Error ? err.message : String(err));
}
