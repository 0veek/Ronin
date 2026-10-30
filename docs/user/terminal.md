# Terminal history

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. Ronin removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when Ronin restores saved terminal
history. A client can show less scrollback than the server keeps.

Use Shift+PageUp and Shift+PageDown to read scrollback without leaving terminal
input. Ctrl+Shift+Home and Ctrl+Shift+End jump to the start and latest output;
use Cmd instead of Ctrl on macOS. Full-screen terminal programs keep these
navigation keys.

To copy all retained output, choose **Select all** in the terminal's context menu,
then copy. Cmd+A on macOS and Ctrl+Shift+A elsewhere select the same output.
Ctrl+A still moves to the beginning of shell input on Windows and Linux.
**Jump to latest** in the context menu returns to the current output.

While selecting text, hold the pointer at the top or bottom edge of the terminal
to scroll through its history. This also works when the terminal reaches the
edge of the window.

The terminal uses separate light and dark ANSI color palettes. Switching the
app theme updates colors in existing output as well as new output.

File links use the terminal environment's working directory, including when it
runs on a remote Windows machine. Windows paths can use backslashes; paths with
spaces must be quoted. Line and column suffixes can appear inside or after the
quotes, such as `"C:\Users\Jane Doe\project\index.ts":12:7`.
