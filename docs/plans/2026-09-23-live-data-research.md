# Live data from the game — research notes

> 2026-09-23 (America/Chicago) · Question from the user: "find a better trigger to write data besides /reload and
> logout — there has to be a timer or something so we can get live data." Status: research done, needs in-game
> verification with `/flprobe io` before we build anything.

## Answer in one paragraph

No WoW client (Forever included) lets an addon write SavedVariables mid-session: they're written only on `/reload`,
logout, disconnect or exit, and no API or CVar forces it. `ReloadUI()` is blocked for addons on Forever. The only
live channel any companion app uses is the client's own **combat log file**, which addons can switch on; Warcraft Logs
and Raider.IO tail it. It carries encounter, zone and kill data, not quests, loot or XP, and it's buffered (minutes
in quiet areas). Whether Forever still writes it at all is unverified.

## ⚠️ Forever doesn't load SavedVariables back

Open bug [forever-bugs #34](https://github.com/ClassicWoWCommunity/forever-bugs/issues/34), reported on build 69913
(our build), confirmed with a pre-seeded file by [forever-addon-kit](https://github.com/Thunderz96/forever-addon-kit):
the client writes `ForeverLedger.lua` but starts the addon with an empty table on every load. So each write holds
only what happened since the previous load, and the next write replaces it.

What that means for us:

- The uploader must see every write. The tray app starts with Windows and uploads within ~2 s of each `/reload`, so
  keep it running whenever WoW runs. Records are acknowledged by key and hash, so nothing already uploaded is lost.
- Run resumption (re-entering a dungeon within 15 min after a `/reload`) and the v0 → v1 migration can't work while
  the bug exists; each load starts a fresh table.
- Verify first (probe item 1). If confirmed, consider writing the last uploaded state back as an addon data file the
  addon loads (forever-addon-kit's `sv_bridge.py` idea).

## Channels

| Channel                                                | Works on Forever?                                              | What it carries                                                                                                             | Latency                                                                                    | Risk                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| SavedVariables                                         | Yes (on reload/logout/exit only)                               | Everything the addon records                                                                                                | Until the player reloads                                                                   | None                                                                                        |
| User-clicked `/reload` (macro or secure macro button)  | Likely (plain `ReloadUI()` from addon code is blocked)         | Same, sooner                                                                                                                | Each click, ~2 s to the server                                                             | None: the player clicks                                                                     |
| Combat log `Logs\WoWCombatLog-*.txt` (`LoggingCombat`) | Unverified (Forever has the 12.0 addon combat-log restriction) | `ZONE_CHANGE`, `ENCOUNTER_START/END`, `UNIT_DIED`/`PARTY_KILL` (mob ids), `COMBATANT_INFO` (gear at pulls), build in header | Buffered: minutes in quiet areas; toggling logging off/on may flush (5 calls / 10 s limit) | Low: Warcraft Logs and Raider.IO do this                                                    |
| Chat log `Logs\WoWChatLog.txt` (`LoggingChat`)         | Unverified                                                     | Client chat lines: own loot, money, "You receive…", system lines; probably not addon `print` text                           | Reported as written only on close                                                          | Contains whispers and guild chat: parse locally against a whitelist, never upload raw lines |
| `CopyToClipboard`                                      | No (secure code only)                                          | —                                                                                                                           | —                                                                                          | Would clobber the clipboard                                                                 |
| Whisper self / private channel / addon messages        | Rejected                                                       | —                                                                                                                           | —                                                                                          | Server traffic, throttled, chat-spam policy                                                 |

## Recommended direction (after the probe)

1. **Checkpoint nudges (addon):** after a boss kill, dungeon completion or quest turn-in, out of combat, print
   "Forever Ledger: N new records — /reload to save". Optionally offer a secure `/reload` macro button. Zero risk,
   small effort, and it makes SavedVariables fresher.
2. **Optional combat-log tail (tray app):** if the probe shows Forever writes the file, the addon keeps
   `LoggingCombat(true)` on and the tray tails `WoWCombatLog-*.txt` for zone, encounter and kill events as provisional
   records, matched to SavedVariables records later by character, build, time and encounter/instance id.
3. **Chat log:** only if the probe shows it flushes promptly, and only whitelisted lines of the player's own loot and
   money.

## Probe checklist (`/flprobe io` automates the logging parts)

1. Load bug: right after login, is `ForeverLedgerDB` empty even though the file on disk has data?
2. Reload: does typed `/reload` work, does an addon button calling `ReloadUI()` get blocked, and does a `/reload`
   macro or a `SecureActionButtonTemplate` (`type=macro`, `macrotext=/reload`) work?
3. Logging state: `LoggingChat()`, `LoggingCombat()`, `C_ChatInfo.IsLoggingChat/Combat()`,
   `GetCVar("advancedCombatLogging")`, `C_CombatLog.IsCombatLogRestricted()`.
4. Turn chat logging on: blocked? Does `Logs\WoWChatLog.txt` appear, and where?
5. Chat log content: an addon `print` marker, `ChatFrame1:AddMessage` marker, loot (item ids or names?), XP, quest
   lines, money.
6. Chat log flush: tail the file (`Get-Content <path> -Wait -Tail 5`) and time lines; does toggling logging flush it?
7. Combat log: file name, header `COMBAT_LOG_VERSION … BUILD_VERSION … PROJECT_ID`, which events appear solo and in a
   dungeon, flush delay, does toggling start a new file and flush the old one, does a 6th call in 10 s return nil?
8. Paths: the install folder (reported as `_classic_beta_`, exe `WowB.exe`) and its `Logs\` folder.

Sources: [warcraft.wiki.gg: Saving variables](https://warcraft.wiki.gg/wiki/Saving_variables_between_game_sessions),
[C_UI.Reload](https://warcraft.wiki.gg/wiki/API_C_UI.Reload), [LoggingCombat](https://warcraft.wiki.gg/wiki/API_LoggingCombat),
[COMBAT_LOG_EVENT](https://warcraft.wiki.gg/wiki/COMBAT_LOG_EVENT), [CopyToClipboard](https://warcraft.wiki.gg/wiki/API_CopyToClipboard),
[wow-recorder](https://github.com/aza547/wow-recorder) ([#45](https://github.com/aza547/wow-recorder/issues/45) flush delay),
[WoWChatParser](https://github.com/Kvalyr/WoWChatParser), [Raider.IO combat logging](https://support.raider.io/kb/raider-dot-io-mythic-plus-addon/how-to-enable-advanced-combat-logging),
[Blizzard UI add-on policy](https://us.forums.blizzard.com/en/wow/t/ui-add-on-development-policy/24534).
