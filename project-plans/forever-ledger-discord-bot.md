# 🤖 Forever Ledger — Discord bot (MCP server step 5)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 03:45 CDT (America/Chicago)
> Parent plan: `forever-ledger-mcp-server.md` step 5. Branch `feat/discord-bot` → PR → merge to `master`.

## 🧭 Why

Ask the ledger from the group's Discord: "@Forever Ledger where do I get Black Pearls?" answers from the ledger only,
with labels, sources and gaps, the same way it does in Claude Code.

## ✅ Decisions (Harlan, 2026-10-07)

1. **A new bot** ("Forever Ledger"), its own Discord application, in this repo (`apps/discord`), PM2 on this VPS.
2. **Claude Sonnet 5** answers by default; **`--opus`** in a question switches that one answer to Claude Opus 5.5.
3. Asked by **@mentioning** the bot; it answers in a thread, and follow-ups in that thread keep the context.
4. **Admins can log observations** ("I fished 30 min at Steamwheedle, 0 clams"): people with a Discord role Harlan
   picks get the MCP write tools; everyone else is read-only.

## 🏗️ Shape

```
Discord @mention ──▶ forever-ledger-discord (PM2, apps/discord, discord.js)
                       │ Messages API (Sonnet 5 / Opus 5.5) + MCP connector (beta mcp-client-2025-11-20)
                       ▼
                     Anthropic ── HTTPS /mcp (Bearer flt_ token) ──▶ forever-ledger-mcp ──▶ Postgres
```

- **MCP connector:** Anthropic calls `https://ledger.willikers.dev/mcp` with the bot's token, so the bot has no tool
  code of its own and every answer goes through the same tools, checks and gaps as Claude Code.
- **Two ledger tokens:** a read-only token (no owner) for everyone, and an admin-owned token used only when the asker
  has the admin role (that token's MCP session offers `log_observation` / `add_claim`).
- **Guard rails:** only the listed server; per-user and bot-wide hourly limits (20 / 60 questions, 5 / 10 on Opus), answers trimmed to Discord's 2,000
  characters (split into a few messages at most), only the asker's question and the thread are sent to Claude, token
  use logged per answer (America/Chicago times). No message content is stored.
- **Discord permissions:** mentions reach the bot without the privileged Message Content intent; it needs View
  Channel, Send Messages, Create Public Threads, Send Messages in Threads, Read Message History.

## 🧰 Setup Harlan does (secrets never in the repo or chat)

1. Discord Developer Portal → New Application "Forever Ledger" → Bot → copy the token, and turn **Public Bot off**
   (only Harlan can invite it).
2. OAuth2 URL with the `bot` scope and the permissions above → invite it to the server.
3. An Anthropic API key (console.anthropic.com).
4. Put `DISCORD_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `DISCORD_GUILD_IDS` (the server's id: required, the bot answers
   nowhere else) and `DISCORD_ADMIN_ROLE_IDS` in `deploy/.env` (the two ledger tokens are minted on the VPS straight
   into that file).

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 📝 Plan; Claude API reference checked (MCP connector, Sonnet 5 / Opus 5.5 thinking rules) — 03:45 CDT
- ✅ 1 🤖 `apps/discord` (discord.js 14, `@anthropic-ai/sdk` 0.131): mention → thread → Claude with the MCP
  connector; `--opus` → Opus 5.5 at high effort; admin role → write token; 20 questions/hour per user (5 on Opus);
  answers split into at most 3 messages, never pinging anyone; PM2 entry `forever-ledger-discord`; 8 tests with a
  fake API; `pnpm check` 1066 tests — 03:50 CDT
- 🟡 2 🔍 Review (0 Critical) → fixed: an admin's answer is read-only when anyone else's question is in the thread (a
  borrowed nickname can't get a claim logged); the bot answers only in `DISCORD_GUILD_IDS` and has bot-wide hourly
  caps; bad limit settings fall back to defaults; unreadable history still gets an answer; the answer is the text
  after the last lookup; automatic prompt caching; one API retry; PM2 stops after 5 failed starts → PR #58
- ⬜ 3 🔑 Harlan: Discord app + invite + API key in `deploy/.env`; ledger tokens minted on the VPS
- ⬜ 4 🚀 PM2 `forever-ledger-discord` started; first real question answered in the server

## ⚠️ Risks

- **Cost:** every question is a paid API call (Opus more so); the per-user limits and the `--opus` cap bound it.
- **Wowhead terms:** answers carry facts, labels and links, never page text (the MCP server already guarantees this).
- **Prompt injection:** anyone in the server can type anything; the bot's read token can't change the ledger, and the
  write token is used only for the admin role.
