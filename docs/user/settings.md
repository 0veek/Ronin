# Settings files

Choose the browser address bar's **Search engine** in **Settings → Integrations → Browser**.
DuckDuckGo is the default. A custom search URL uses `%s` for the search terms;
an invalid custom URL falls back to DuckDuckGo. Switching engines keeps your
custom URL, and resetting the setting clears it. Addresses still open directly.

In **Settings → Appearance**, enable **Render math** to typeset LaTeX in chat and
Markdown previews. It is off by default and saved separately on each device.
Formulas use `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, or fenced `math` blocks outside code.
The composer keeps TeX editable; copying formulas, quoting them, and exporting
tables preserves their TeX source. Wide formulas scroll horizontally.

Ronin preserves symbolic links when saving server settings, desktop app settings, and desktop
client preferences. You can keep those files in a dotfiles directory and link them into Ronin's
data directory. Saving from Settings updates the destination file and leaves the link in place.

The environment also notices changes to its linked server settings, including replacing the
destination file or repointing the link.
