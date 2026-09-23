import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSavedVariables, SavedVariablesParseError } from '../src/index.js';

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../fixtures/synthetic/parser/${name}`, import.meta.url)),
  );

function expectParseError(input: Buffer | string, reason: SavedVariablesParseError['reason']) {
  try {
    parseSavedVariables(input);
  } catch (err) {
    expect(err).toBeInstanceOf(SavedVariablesParseError);
    expect((err as SavedVariablesParseError).reason).toBe(reason);
    return err as SavedVariablesParseError;
  }
  throw new Error('expected parse to fail');
}

describe('parseSavedVariables — WoW serializer output', () => {
  const sv = parseSavedVariables(fixture('wow-format.lua'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = sv.ForeverLedgerDB as any;

  it('returns one entry per top-level assignment and drops nil assignments', () => {
    expect(Object.keys(sv)).toEqual(['ForeverLedgerDB']);
  });

  it('turns 1..n tables into arrays, ignoring -- [n] comments', () => {
    expect(db.meta.build).toEqual(['1.15.7', '61582', 'Sep 18 2026', 11507]);
    expect(db.quests['1234'].choices).toEqual([
      { itemID: 5555, count: 1 },
      { itemID: 5556, count: 1 },
    ]);
  });

  it('keeps numeric keys that are not a sequence as object keys', () => {
    expect(db.drops['5555']).toEqual({ '0': 1, '1706': 3 });
    expect(db.quests['1234'].id).toBe(1234);
  });

  it('drops nil fields', () => {
    expect('suggestedGroup' in db.quests['1234']).toBe(false);
    expect(db.quests['1234'].isDungeon).toBe(true);
  });

  it('decodes escapes and keeps WoW markup verbatim', () => {
    expect(db.quests['1234'].title).toBe('The "Swamp" Thing');
    expect(db.weird.esc).toBe('tab\there\nnewline \\ backslash AB');
    expect(db.items['5555'].link).toBe(
      "|cff1eff00|Hitem:5555::::::::14:::::::|h[Swampwalker's Boots]|h|r",
    );
    expect(db.items['5555'].tooltip[1]).toBe('Feet || Leather');
  });

  it('handles negative, float, hex and exponent numbers and odd keys', () => {
    expect(db.weird['-5']).toBe(-12.5);
    expect(db.weird['1.5']).toBe('float key');
    expect(db.weird.true).toBe('bool key');
    expect(db.weird.hex).toBe(31);
    expect(db.weird.exp).toBe(1500);
    expect(db.giver).toBeUndefined();
    expect(db.quests['1234'].giver.loc).toEqual({
      x: 42.1,
      y: 65.9,
      zone: 'Elwynn Forest',
      subzone: 'Goldshire',
    });
  });

  it('represents an empty table as an empty object', () => {
    expect(db.runs).toEqual({});
  });
});

describe('parseSavedVariables — encodings and shapes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = parseSavedVariables(fixture('utf8-and-shapes.lua')).ForeverLedgerDB as any;

  it('decodes UTF-8 from raw bytes', () => {
    expect(db.chars).toEqual(['Café', 'Łukasz', '日本']);
  });

  it('gives the same result for a Buffer and an already-decoded string', () => {
    const text = fixture('utf8-and-shapes.lua').toString('utf8');
    expect(parseSavedVariables(text)).toEqual(parseSavedVariables(fixture('utf8-and-shapes.lua')));
  });

  it('keeps sparse and mixed tables as objects', () => {
    expect(db.sparse).toEqual({ '1': 'a', '3': 'c' });
    expect(db.mixed).toEqual({ '1': 'first', named: 'x' });
  });

  it('treats __proto__ as an ordinary key', () => {
    const out = parseSavedVariables('X = { ["__proto__"] = { ["polluted"] = true } }');
    const x = out.X as Record<string, unknown>;
    expect(Object.keys(x)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('lets positional fields win over explicit keys at the same index (Lua semantics)', () => {
    expect(parseSavedVariables('X = { [1] = "explicit", "positional" }').X).toEqual(['positional']);
  });
});

describe('parseSavedVariables — rejects anything but data', () => {
  it('fails cleanly on a truncated (half-written) file', () => {
    const err = expectParseError(fixture('truncated.lua'), 'truncated');
    expect(err.line).toBeGreaterThan(1);
  });

  it('fails cleanly when a file is cut at a table boundary', () => {
    const full = fixture('wow-format.lua').toString('utf8');
    const cut = full.slice(0, full.indexOf('["items"]'));
    expectParseError(cut, 'truncated');
  });

  it('fails on an empty-but-started assignment', () => {
    expectParseError('ForeverLedgerDB = ', 'truncated');
  });

  it('rejects function calls without evaluating them', () => {
    const err = expectParseError(fixture('function-call.lua'), 'unsupported');
    expect(err.message).toMatch(/CallExpression/);
    expect(err.line).toBe(2);
  });

  it('rejects local statements and identifier references', () => {
    expectParseError(fixture('local-statement.lua'), 'unsupported');
    expectParseError(fixture('identifier-value.lua'), 'unsupported');
  });

  it('rejects arithmetic, concatenation and member access', () => {
    expectParseError('X = { 1 + 2 }', 'unsupported');
    expectParseError('X = { "a" .. "b" }', 'unsupported');
    expectParseError('X = { a.b }', 'unsupported');
    expectParseError('X = function() end', 'unsupported');
    expectParseError('X.y = 1', 'unsupported');
  });

  it('rejects plain syntax errors', () => {
    expectParseError('X = { = }', 'syntax');
  });

  it('enforces a maximum nesting depth', () => {
    const deep = 'X = ' + '{'.repeat(70) + '}'.repeat(70);
    expect(() => parseSavedVariables(deep)).toThrow(SavedVariablesParseError);
    expect(() => parseSavedVariables(deep, { maxDepth: 100 })).not.toThrow();
  });
});

describe('parseSavedVariables — size', () => {
  it('parses a 5,000-record file quickly', () => {
    const rows: string[] = [];
    for (let i = 1; i <= 5000; i++) {
      rows.push(
        `\t\t{\n\t\t\t["id"] = "Char-Realm-${i}-1790000000",\n\t\t\t["xp"] = ${i * 10},\n` +
          `\t\t\t["tooltip"] = {\n\t\t\t\t"|cffffd100Line ${i}|r", -- [1]\n\t\t\t},\n\t\t}, -- [${i}]`,
      );
    }
    const text = `ForeverLedgerDB = {\n\t["turnIns"] = {\n${rows.join('\n')}\n\t},\n}\n`;
    const start = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = parseSavedVariables(text).ForeverLedgerDB as any;
    const ms = performance.now() - start;
    expect(db.turnIns).toHaveLength(5000);
    expect(db.turnIns[4999].xp).toBe(50000);
    expect(ms).toBeLessThan(3000);
  });
});
