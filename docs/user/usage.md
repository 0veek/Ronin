# Review usage

The Stats page combines Codex, Claude Code, Grok, OpenCode, Antigravity, and Cursor activity from your connected
environments. It reads the providers' local session history, so turns you ran outside Ronin are
counted too. It shows API-equivalent token cost, processed tokens, cache savings, provider shares,
and model breakdowns. Subscription billing is separate from the raw token cost shown here.

Use **24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**, **30
days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the headline
and chart, and refreshing rescans every connected environment.

Each provider owns one colour across the whole page — the chart, the split, the share bars, and the
model rows all key to the same set, in light and dark alike. The brand mark beside every value
carries the same identity, so nothing on the page depends on telling two hues apart.

Grok totals come from the session records it writes as each turn completes, so a turn that never
finished writing one does not appear.

OpenCode reads its SQLite database and older JSON history. Antigravity reads local conversation
databases, including Ronin-managed profiles. Set `OPENCODE_DATA_DIR` or `ANTIGRAVITY_DATA_DIR` on
the server to read a different data directory; comma-separated paths read multiple directories.

Cursor reads account usage from Cursor's dashboard API using the CLI login saved on the server.
This includes headless Ronin sessions and desktop usage across machines; the same account counts
once across connected environments. Without an accessible CLI login, Ronin shows a notice instead
of incomplete local totals. On macOS, choose **Enable** on the Stats page to allow Ronin to read the
existing CLI login from Keychain. You can turn it off under **Settings → Providers → Advanced**.

Usage includes each configured account's history, including disabled accounts. Custom homes follow
the account's home setting or its `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, or `GROK_HOME` environment
variable. Use absolute paths or `~/` paths in account environment settings; accounts that share a
history directory are counted once.

Where a cost figure comes from depends on the provider: Grok records the exact cost of each turn and
that figure is used as-is, while Codex, Claude Code, OpenCode, Cursor, and Antigravity totals are priced from a
published rate table. Models with no published rate still count their tokens; their cost is reported
as zero and the share of records that affects is printed under the breakdown.

Antigravity runs some generations for itself — the checkpoint that closes a turn, for instance — and
records those under a placeholder model name rather than a real one. Their tokens are counted like
any other, but because the name identifies a selection rule instead of a model, they have no rate to
price against and land in that unpriced share. They are a small fraction of tokens and a larger
fraction of records, so the unpriced figure reads higher than the cost it withholds.
