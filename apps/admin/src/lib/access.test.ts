import { describe, expect, it } from 'vitest';
import type { AdminUser, Token } from '../types';
import {
  helperAction,
  isLastAdmin,
  labelProblem,
  pendingHelpers,
  READ_SCOPE_LABEL,
  readToggle,
  sortTokens,
} from './access';

const user = (id: number, role: 'admin' | 'member'): AdminUser => ({
  id,
  battletag: `U#${id}`,
  role,
  createdAt: '2026-09-23T19:00:00-05:00',
  lastLoginAt: null,
  tokens: 0,
});

const token = (id: number, revoked = false): Token => ({
  id,
  label: `t${id}`,
  createdAt: '2026-09-23T19:00:00-05:00',
  revokedAt: revoked ? '2026-09-23T20:00:00-05:00' : null,
  lastUsedAt: null,
  owner: null,
  canRead: false,
  canFetch: false,
  helper: null,
  uploads: 0,
  lastUploadAt: null,
});

describe('isLastAdmin', () => {
  it('is true only for the single admin', () => {
    const users = [user(1, 'admin'), user(2, 'member')];
    expect(isLastAdmin(users, 1)).toBe(true);
    expect(isLastAdmin(users, 2)).toBe(false);
    expect(isLastAdmin([...users, user(3, 'admin')], 1)).toBe(false);
  });
});

describe('sortTokens', () => {
  it('lists active tokens newest first, revoked ones last', () => {
    expect(sortTokens([token(1), token(2, true), token(3)]).map((t) => t.id)).toEqual([3, 1, 2]);
  });
});

describe('labelProblem', () => {
  it('needs a non-blank label up to 100 characters', () => {
    expect(labelProblem('cody')).toBeNull();
    expect(labelProblem('   ')).toMatch(/label/);
    expect(labelProblem('x'.repeat(101))).toMatch(/100/);
  });
});

describe('read scope', () => {
  it('names what reading means', () => {
    expect(READ_SCOPE_LABEL).toBe('can read all data (API/export)');
  });

  it('grants reading to an upload token, with a confirm that says what it unlocks', () => {
    const t = readToggle({ ...token(1), canRead: false });
    expect(t.next).toBe(true);
    expect(t.button).toMatch(/allow reading/i);
    expect(t.confirm).toMatch(/all data/i);
    expect(t.danger).toBe(true);
  });

  it('takes reading back from a reader token', () => {
    const t = readToggle({ ...token(1), canRead: true });
    expect(t.next).toBe(false);
    expect(t.button).toMatch(/upload only/i);
    expect(t.danger).toBe(false);
  });
});

describe('tray helpers', () => {
  it('approves a pending helper, pauses an approved one, resumes a paused one', () => {
    expect(helperAction({ status: 'pending' })).toMatchObject({
      next: 'approved',
      button: 'Approve',
    });
    expect(helperAction({ status: 'approved' })).toMatchObject({ next: 'paused', button: 'Pause' });
    expect(helperAction({ status: 'paused' })).toMatchObject({
      next: 'approved',
      button: 'Resume',
    });
  });

  it('counts only live helpers waiting for approval', () => {
    const base = {
      label: 'x',
      createdAt: '',
      lastUsedAt: null,
      owner: null,
      canRead: false,
      canFetch: true,
      uploads: 0,
      lastUploadAt: null,
    };
    const helper = (status: 'pending' | 'approved', revokedAt: string | null = null) => ({
      ...base,
      id: Math.random(),
      revokedAt,
      helper: { status, of: 1, dailyBudget: 200, fetchedToday: 0, fetchedTotal: 0 },
    });
    expect(
      pendingHelpers([helper('pending'), helper('approved'), helper('pending', '2026-10-07')]),
    ).toHaveLength(1);
  });
});
