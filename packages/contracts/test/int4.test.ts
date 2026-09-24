// Ids, builds, counts and prices land in Postgres int4 columns (or are read back as int4 from jsonb): a value out of
// int4 range is an invalid record, refused on its own like any other invalid record.
import { describe, expect, it } from 'vitest';
import {
  Drop,
  INT4_MAX,
  normalize,
  Quest,
  RecipeSnapshot,
  Trainer,
  TurnIn,
  Vendor,
} from '../src/index.js';

const OVER = INT4_MAX + 1;

describe('int4 bounds', () => {
  it('INT4_MAX is the Postgres integer maximum', () => {
    expect(INT4_MAX).toBe(2_147_483_647);
  });

  it('accepts INT4_MAX and refuses one more, for ids, builds, counts and prices', () => {
    const vendor = (item: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      Vendor.safeParse({ npcId: 1, build: 1, seenAt: 1, items: [{ itemId: 1, ...item }], ...extra })
        .success;
    expect(vendor({ itemId: INT4_MAX, price: INT4_MAX })).toBe(true);
    expect(vendor({ itemId: 3_000_000_000 })).toBe(false);
    expect(vendor({ price: 1e12 })).toBe(false);
    expect(vendor({ stack: OVER })).toBe(false);
    expect(vendor({ numAvailable: -OVER - 1 })).toBe(false);
    expect(vendor({ currencyId: OVER })).toBe(false);
    expect(vendor({ costs: [{ amount: OVER, itemId: 1 }] })).toBe(false);
    expect(vendor({ costs: [{ amount: 1, currencyId: OVER }] })).toBe(false);
    expect(vendor({}, { npcId: OVER })).toBe(false);
    expect(vendor({}, { build: OVER })).toBe(false);

    const recipe = (reagent: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      RecipeSnapshot.safeParse({ recipeId: 1, build: 1, reagents: [reagent], ...extra }).success;
    expect(recipe({ itemId: 1, qty: 1 })).toBe(true);
    expect(recipe({ itemId: OVER, qty: 1 })).toBe(false);
    expect(recipe({ itemId: 1, qty: -1.5 })).toBe(false);
    expect(recipe({ itemId: 1, qty: 1 }, { recipeId: OVER })).toBe(false);
    expect(recipe({ itemId: 1, qty: 1 }, { outputItemId: OVER })).toBe(false);

    expect(
      Trainer.safeParse({
        npcId: 1,
        build: 1,
        seenAt: 1,
        skillLineId: OVER,
        services: [],
      }).success,
    ).toBe(false);
    expect(
      Trainer.safeParse({
        npcId: 1,
        build: 1,
        seenAt: 1,
        services: [{ name: 'x', itemId: OVER }],
      }).success,
    ).toBe(false);
    expect(Quest.safeParse({ questId: OVER }).success).toBe(false);
    expect(Drop.safeParse({ itemId: 1, build: 1, npcId: OVER, count: 1 }).success).toBe(false);
    expect(
      TurnIn.safeParse({ id: 'a', questId: 1, build: 1, char: 'A-R', time: 1, money: OVER })
        .success,
    ).toBe(false);
  });

  it('keeps epoch seconds past 2038 (stored as timestamptz, not int4)', () => {
    expect(
      TurnIn.safeParse({ id: 'a', questId: 1, build: 1, char: 'A-R', time: 4_102_444_800 }).success,
    ).toBe(true);
  });

  it('normalize refuses the out-of-range record only, keeping the others', () => {
    const db = {
      meta: { schemaVersion: 5, addonVersion: '0.3.3', build: 5 },
      vendors: {
        [5]: {
          [1]: { seenAt: 10, items: [{ itemID: 1, price: 100 }] },
          [2]: { seenAt: 10, items: [{ itemID: 3_000_000_000, price: 100 }] },
        },
      },
    };
    const { records, problems } = normalize(db);
    expect(records.vendors.map((v) => v.npcId)).toEqual([1]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: 'vendors' });
  });
});
