-- Forever Ledger addon tests (Lua 5.1). Run from addon/tests: lua5.1 run.lua
-- Also regenerates fixtures/synthetic/*.lua used by the TypeScript packages.
package.path = "./?.lua;" .. package.path
local H = require("harness")

local suites = { "test_ledger", "test_migration", "test_probe", "test_nudge", "test_rewards_objectives",
                 "test_loot" }
for _, name in ipairs(suites) do require(name)(H) end

local r = H.results
for _, f in ipairs(r.failures) do print("FAIL " .. f) end
print(string.format("addon tests: %d passed, %d failed", r.passed, r.failed))
if r.failed > 0 then os.exit(1) end
