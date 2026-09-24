import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { postJson, useAdminQuery, useCsrf, useMe } from '../api';
import type { Role } from '../api';
import { Card } from '../components/Card';
import { ConfirmButton } from '../components/ConfirmButton';
import { DataTable } from '../components/DataTable';
import type { SortableFeatures } from '../components/DataTable';
import { ErrorState, QueryState } from '../components/State';
import {
  isLastAdmin,
  labelProblem,
  READ_SCOPE_LABEL,
  readToggle,
  sortTokens,
  TOKEN_LABEL_MAX,
} from '../lib/access';
import { formatNumber } from '../lib/format';
import { formatChicago, formatChicagoShort, timeAgo } from '../lib/time';
import type { AdminUser, Items, MintedToken, Token } from '../types';

const USERS_KEY = ['users'];
const TOKENS_KEY = ['tokens'];

/** Everything that shows token owners or roles is stale after a write. */
function useInvalidateAccess() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [USERS_KEY, TOKENS_KEY, ['characters'], ['uploads'], ['me']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

export function AccessPage() {
  const users = useAdminQuery<Items<AdminUser>>(USERS_KEY, '/admin/api/users');
  return (
    <div className="page">
      <header className="page-head">
        <h1>Access</h1>
        <p className="muted">
          Who can log in, and the tokens the tray apps use. Characters uploaded with a token belong
          to its owner. Tokens only upload unless they may read: a reader token sees everyone's data
          through the API and export, so keep that for your own scripts.
        </p>
      </header>
      <MintCard users={users.data?.items ?? []} />
      <TokensCard users={users.data?.items ?? []} />
      <Card title="Users">
        <QueryState query={users}>{({ items }) => <UsersTable users={items} />}</QueryState>
      </Card>
    </div>
  );
}

function MintCard({ users }: { users: AdminUser[] }) {
  const csrf = useCsrf();
  const invalidate = useInvalidateAccess();
  const [label, setLabel] = useState('');
  const [owner, setOwner] = useState('');
  const [canRead, setCanRead] = useState(false);
  const [touched, setTouched] = useState(false);
  // The plaintext lives only in this mutation's result: reset() drops it when the box is hidden or the page left,
  // and gcTime 0 lets the mutation cache forget it at once.
  const mint = useMutation({
    mutationFn: (body: { label: string; ownerUserId: number | null; canRead: boolean }) =>
      postJson<MintedToken>('/admin/api/tokens', csrf, body),
    gcTime: 0,
    onSuccess: () => {
      setLabel('');
      setOwner('');
      setCanRead(false);
      setTouched(false);
      void invalidate();
    },
  });
  const { reset } = mint;
  useEffect(() => reset, [reset]);
  const problem = labelProblem(label);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    reset();
    mint.mutate({ label: label.trim(), ownerUserId: owner ? Number(owner) : null, canRead });
  };
  return (
    <Card title="Mint a token">
      <form className="mint" onSubmit={submit} noValidate>
        <label>
          Label
          <input
            value={label}
            maxLength={TOKEN_LABEL_MAX + 20}
            placeholder="e.g. cody's gaming PC"
            onChange={(e) => setLabel(e.target.value)}
            aria-invalid={touched && problem !== null}
          />
        </label>
        <label>
          Owner
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">nobody yet</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.battletag}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox" title="Off: the token only uploads (what the tray app needs)">
          <input type="checkbox" checked={canRead} onChange={(e) => setCanRead(e.target.checked)} />
          {READ_SCOPE_LABEL}
        </label>
        <button type="submit" disabled={mint.isPending}>
          {mint.isPending ? 'Minting…' : 'Mint token'}
        </button>
      </form>
      {touched && problem && <p className="field-error">{problem}</p>}
      {mint.isError && <ErrorState error={mint.error} />}
      {mint.data && <MintedBox token={mint.data} onDone={reset} />}
    </Card>
  );
}

/** The one time a token's plaintext is visible: copy it now. */
function MintedBox({ token, onDone }: { token: MintedToken; onDone: () => void }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <div className="callout warn minted" role="alert">
      <p>
        <strong>
          Token #{token.id} "{token.label}"
        </strong>
        {token.owner ? ` for ${token.owner.battletag}` : ''}
        {token.canRead ? `, ${READ_SCOPE_LABEL}` : ', upload only'}. Copy it now: it won't be shown
        again (only its hash is stored). Paste it into the tray app's settings.
      </p>
      <div className="copy-box">
        <input
          readOnly
          value={token.token}
          aria-label="New token"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" onClick={() => void copy()}>
          {copied === 'yes' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copied === 'failed' && (
        <p className="small">Couldn't reach the clipboard: select the text and copy it by hand.</p>
      )}
      <button type="button" className="secondary small" onClick={onDone}>
        I've saved it, hide it
      </button>
    </div>
  );
}

function TokensCard({ users }: { users: AdminUser[] }) {
  const tokens = useAdminQuery<Items<Token>>(TOKENS_KEY, '/admin/api/tokens');
  const csrf = useCsrf();
  const invalidate = useInvalidateAccess();
  const revoke = useMutation({
    mutationFn: (id: number) => postJson(`/admin/api/tokens/${id}/revoke`, csrf),
    onSettled: () => invalidate(),
  });
  const setOwner = useMutation({
    mutationFn: ({ id, userId }: { id: number; userId: number | null }) =>
      postJson(`/admin/api/tokens/${id}/owner`, csrf, { userId }),
    onSettled: () => invalidate(),
  });
  const setRead = useMutation({
    mutationFn: ({ id, canRead }: { id: number; canRead: boolean }) =>
      postJson(`/admin/api/tokens/${id}/read`, csrf, { canRead }),
    onSettled: () => invalidate(),
  });

  const col = createColumnHelper<SortableFeatures, Token>();
  const columns = col.columns([
    col.accessor('id', { header: '#' }),
    col.accessor('label', {
      header: 'Label',
      cell: (c) => (
        <span>
          {c.getValue()}
          {c.row.original.revokedAt && <span className="pill neutral">revoked</span>}
        </span>
      ),
    }),
    col.accessor((t) => t.owner?.battletag ?? '', {
      id: 'owner',
      header: 'Owner',
      cell: (c) => {
        const t = c.row.original;
        return (
          <select
            aria-label={`Owner of token ${t.label}`}
            value={t.owner?.id ?? ''}
            disabled={setOwner.isPending}
            onChange={(e) =>
              setOwner.mutate({ id: t.id, userId: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">nobody</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.battletag}
              </option>
            ))}
          </select>
        );
      },
    }),
    col.accessor((t) => Number(t.canRead), {
      id: 'scope',
      header: 'Scope',
      cell: (c) => {
        const t = c.row.original;
        const toggle = readToggle(t);
        return (
          <span className="scope">
            {t.canRead ? (
              <span className="pill sev-warn" title={READ_SCOPE_LABEL}>
                upload + read
              </span>
            ) : (
              <span className="pill neutral">upload only</span>
            )}
            {!t.revokedAt && (
              <ConfirmButton
                danger={toggle.danger}
                disabled={setRead.isPending}
                confirmLabel={toggle.confirm}
                onConfirm={() => setRead.mutate({ id: t.id, canRead: toggle.next })}
                title={t.canRead ? undefined : READ_SCOPE_LABEL}
              >
                {toggle.button}
              </ConfirmButton>
            )}
          </span>
        );
      },
    }),
    col.accessor((t) => (t.lastUsedAt ? Date.parse(t.lastUsedAt) : 0), {
      id: 'lastUsed',
      header: 'Last used',
      cell: (c) => {
        const v = c.row.original.lastUsedAt;
        return v ? (
          <span title={formatChicago(v)}>{timeAgo(v)}</span>
        ) : (
          <span className="muted">never</span>
        );
      },
    }),
    col.accessor('uploads', {
      header: 'Uploads',
      cell: (c) => {
        const t = c.row.original;
        return (
          <span>
            {formatNumber(t.uploads)}
            {t.lastUploadAt && (
              <span className="muted small"> · last {formatChicagoShort(t.lastUploadAt)}</span>
            )}
          </span>
        );
      },
    }),
    col.accessor((t) => Date.parse(t.createdAt), {
      id: 'createdAt',
      header: 'Created',
      cell: (c) => <span className="nowrap">{formatChicagoShort(c.row.original.createdAt)}</span>,
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: (c) => {
        const t = c.row.original;
        if (t.revokedAt)
          return <span className="muted small">revoked {formatChicagoShort(t.revokedAt)}</span>;
        return (
          <ConfirmButton
            danger
            confirmLabel="Revoke now"
            disabled={revoke.isPending}
            onConfirm={() => revoke.mutate(t.id)}
            title="The tray app using it will stop uploading"
          >
            Revoke
          </ConfirmButton>
        );
      },
    }),
  ]);

  return (
    <Card title="Tokens">
      {revoke.isError && <ErrorState error={revoke.error} />}
      {setOwner.isError && <ErrorState error={setOwner.error} />}
      {setRead.isError && <ErrorState error={setRead.error} />}
      <QueryState query={tokens}>
        {({ items }) => (
          <DataTable
            data={sortTokens(items)}
            columns={columns}
            rowKey={(t) => t.id}
            rowClassName={(t) => (t.revokedAt ? 'dim' : undefined)}
            empty="No tokens yet."
          />
        )}
      </QueryState>
    </Card>
  );
}

function UsersTable({ users }: { users: AdminUser[] }) {
  const me = useMe().data?.user;
  const csrf = useCsrf();
  const invalidate = useInvalidateAccess();
  const role = useMutation({
    mutationFn: ({ id, next }: { id: number; next: Role }) =>
      postJson(`/admin/api/users/${id}/role`, csrf, { role: next }),
    onSettled: () => invalidate(),
  });

  const col = createColumnHelper<SortableFeatures, AdminUser>();
  const columns = col.columns([
    col.accessor('battletag', {
      header: 'BattleTag',
      cell: (c) => (
        <span>
          {c.getValue()}
          {c.row.original.id === me?.id && <span className="pill neutral">you</span>}
        </span>
      ),
    }),
    col.accessor('role', {
      header: 'Role',
      cell: (c) => <span className="badge">{c.getValue()}</span>,
    }),
    col.accessor('tokens', { header: 'Tokens' }),
    col.accessor((u) => (u.lastLoginAt ? Date.parse(u.lastLoginAt) : 0), {
      id: 'lastLogin',
      header: 'Last login',
      cell: (c) => {
        const v = c.row.original.lastLoginAt;
        return v ? (
          <span title={formatChicago(v)}>{timeAgo(v)}</span>
        ) : (
          <span className="muted">—</span>
        );
      },
    }),
    col.accessor((u) => Date.parse(u.createdAt), {
      id: 'createdAt',
      header: 'Joined',
      cell: (c) => <span className="nowrap">{formatChicagoShort(c.row.original.createdAt)}</span>,
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: (c) => {
        const u = c.row.original;
        const next: Role = u.role === 'admin' ? 'member' : 'admin';
        const last = u.role === 'admin' && isLastAdmin(users, u.id);
        const self = u.id === me?.id;
        return (
          <ConfirmButton
            danger={next === 'member'}
            disabled={role.isPending || last}
            title={last ? 'The last admin cannot be demoted' : undefined}
            confirmLabel={
              next === 'admin'
                ? `Make ${u.battletag} admin`
                : self
                  ? 'Demote myself (I lose access)'
                  : `Demote ${u.battletag}`
            }
            onConfirm={() => role.mutate({ id: u.id, next })}
          >
            {next === 'admin' ? 'Make admin' : 'Make member'}
          </ConfirmButton>
        );
      },
    }),
  ]);

  return (
    <>
      {role.isError && <ErrorState error={role.error} />}
      <DataTable data={users} columns={columns} rowKey={(u) => u.id} empty="No users yet." />
      <p className="muted small">
        Members can log in but see "not authorized" until they're made admin.
      </p>
    </>
  );
}
