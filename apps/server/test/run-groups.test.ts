// The run grouping rule (no database): which uploaded runs are one shared dungeon run seen by several characters.
import { describe, expect, it } from 'vitest';
import { GROUP_WINDOW_SECS, groupRuns, sameRun } from '../src/runGroups.js';
import type { GroupableRun } from '../src/runGroups.js';

const T0 = 1_790_000_000;

/** The live Wailing Caverns shape: Sam (druid 20) and Vic (warrior 20), a hunter, a shaman and a warlock. */
const sam: GroupableRun = {
  id: 'Sam Willikers-Classic Beta PvE-43-1790000000',
  char: 'Sam Willikers-Classic Beta PvE',
  charClass: 'DRUID',
  charLevel: 20,
  instanceId: 43,
  build: 69977,
  startedAt: T0,
  party: [
    { class: 'WARRIOR', level: 20 },
    { class: 'HUNTER', level: 20 },
    { class: 'SHAMAN', level: 20 },
    { class: 'WARLOCK', level: 18 },
  ],
};
const vic: GroupableRun = {
  id: 'Vic Vinny-Classic Beta PvE 2-43-1790000001',
  char: 'Vic Vinny-Classic Beta PvE 2',
  charClass: 'WARRIOR',
  charLevel: 20,
  instanceId: 43,
  build: 69977,
  startedAt: T0 + 1,
  party: [
    { class: 'DRUID', level: 20 },
    { class: 'HUNTER', level: 20 },
    { class: 'SHAMAN', level: 20 },
    { class: 'WARLOCK', level: 18 },
  ],
};
/** The hunter of the same party, also running the addon. */
const hunter: GroupableRun = {
  id: 'Hunt-Realm-43-1790000030',
  char: 'Hunt-Realm',
  charClass: 'HUNTER',
  charLevel: 20,
  instanceId: 43,
  build: 69977,
  startedAt: T0 + 30,
  party: [
    { class: 'DRUID', level: 20 },
    { class: 'WARRIOR', level: 20 },
    { class: 'SHAMAN', level: 20 },
    { class: 'WARLOCK', level: 18 },
  ],
};

describe('sameRun', () => {
  it('matches two members that list each other (class and level) in their party', () => {
    expect(sameRun(sam, vic)).toBe(true);
    expect(sameRun(vic, sam)).toBe(true);
  });

  it('compares classes case-insensitively', () => {
    expect(sameRun(sam, { ...vic, charClass: 'warrior' })).toBe(true);
  });

  it('needs the evidence both ways', () => {
    // Vic's party has no level-20 druid: Sam is not in it.
    const other = { ...vic, party: vic.party.map((p) => ({ ...p, level: 30 })) };
    expect(sameRun(sam, other)).toBe(false);
    // Sam's party has no warrior at Vic's level.
    expect(sameRun(sam, { ...vic, charLevel: 21 })).toBe(false);
    // Unknown class or level is no evidence.
    expect(sameRun(sam, { ...vic, charClass: null })).toBe(false);
    expect(sameRun(sam, { ...vic, charLevel: null })).toBe(false);
  });

  it('accepts one-sided evidence when the other side recorded no party', () => {
    expect(sameRun(sam, { ...vic, party: [] })).toBe(true);
    expect(sameRun({ ...sam, party: [] }, vic)).toBe(true);
    // One side empty and the other side does not list it.
    expect(sameRun(sam, { ...vic, charClass: 'MAGE', party: [] })).toBe(false);
    // Two solo runs are never the same run.
    expect(sameRun({ ...sam, party: [] }, { ...vic, party: [] })).toBe(false);
  });

  it(`needs starts at most ${GROUP_WINDOW_SECS} s apart (inclusive), either way`, () => {
    expect(sameRun(sam, { ...vic, startedAt: T0 + GROUP_WINDOW_SECS })).toBe(true);
    expect(sameRun(sam, { ...vic, startedAt: T0 - GROUP_WINDOW_SECS })).toBe(true);
    expect(sameRun(sam, { ...vic, startedAt: T0 + GROUP_WINDOW_SECS + 1 })).toBe(false);
    expect(sameRun(sam, { ...vic, startedAt: T0 - GROUP_WINDOW_SECS - 1 })).toBe(false);
  });

  it('needs the same instance and the same build', () => {
    expect(sameRun(sam, { ...vic, instanceId: 36 })).toBe(false);
    expect(sameRun(sam, { ...vic, build: 69978 })).toBe(false);
  });

  it('never matches two runs of the same character', () => {
    expect(sameRun(sam, { ...sam, id: 'other', startedAt: T0 + 5 })).toBe(false);
    expect(sameRun(sam, { ...vic, char: sam.char })).toBe(false);
  });
});

describe('groupRuns', () => {
  it('maps every run to the id of the earliest run of its group', () => {
    expect(groupRuns([vic, sam])).toEqual(
      new Map([
        [sam.id, sam.id],
        [vic.id, sam.id],
      ]),
    );
  });

  it('keeps unmatched runs on their own', () => {
    const solo = { ...sam, id: 'solo', char: 'Solo-Realm', charClass: 'MAGE', party: [] };
    const other = { ...vic, id: 'wc-later', startedAt: T0 + 3600 };
    const g = groupRuns([sam, vic, solo, other]);
    expect(g.get(solo.id)).toBe(solo.id);
    expect(g.get(other.id)).toBe(other.id);
    expect(g.get(vic.id)).toBe(sam.id);
  });

  it('is transitive: a third member joins when it matches any member', () => {
    // The hunter lists Vic and Sam, but only Vic lists a hunter here: it still joins through Vic.
    const samNoHunter = { ...sam, party: sam.party.filter((p) => p.class !== 'HUNTER') };
    expect(sameRun(samNoHunter, hunter)).toBe(false);
    const g = groupRuns([hunter, vic, samNoHunter]);
    expect([...g.values()]).toEqual([sam.id, sam.id, sam.id]);
  });

  it('chains past the window through members: the earliest id wins', () => {
    // late starts 210 s after Sam (too far) but 110 s after Vic, who matches Sam.
    const late = { ...hunter, id: 'late', startedAt: T0 + GROUP_WINDOW_SECS + 30 };
    const vicMid = { ...vic, startedAt: T0 + 100 };
    expect(sameRun(sam, late)).toBe(false);
    expect(sameRun(vicMid, late)).toBe(true);
    expect(groupRuns([late, vicMid, sam]).get('late')).toBe(sam.id);
  });

  it('never puts two runs of one character in a group, even through another member', () => {
    // Sam twice (a re-entered instance 60 s later) with Vic between: Vic joins the closer Sam run only.
    const sam2 = { ...sam, id: 'sam-2', startedAt: T0 + 60 };
    const g = groupRuns([sam, vic, sam2]);
    expect(g.get(vic.id)).toBe(sam.id);
    expect(g.get(sam2.id)).toBe(sam2.id);
  });

  it('breaks start-time ties by id', () => {
    const a = { ...sam, id: 'b-run', startedAt: T0 };
    const b = { ...vic, id: 'a-run', startedAt: T0 };
    expect(groupRuns([a, b]).get('b-run')).toBe('a-run');
  });

  it('gives the same answer whatever the input order', () => {
    const runs = [sam, vic, hunter];
    const expected = groupRuns(runs);
    expect(groupRuns([...runs].reverse())).toEqual(expected);
    expect(groupRuns([vic, hunter, sam])).toEqual(expected);
  });
});
