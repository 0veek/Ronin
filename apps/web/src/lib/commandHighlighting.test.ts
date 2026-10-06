import { describe, expect, it } from "vite-plus/test";
import { commandHighlightLanguage, withVisibleControlCharacters } from "./commandHighlighting";

describe("commandHighlightLanguage", () => {
  it.each([
    [
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command "Get-ChildItem -Recurse"',
      "powershell",
    ],
    [
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\work\\scripts\\doctor.ps1"',
      "powershell",
    ],
    ["& pwsh -c 'Get-Date'", "powershell"],
    ["PWSH.EXE -Command Get-Date", "powershell"],
    ["pwsh-preview -c 'Get-Date'", "shellscript"],
    ["git status; pwsh -c 'Get-Date'", "shellscript"],
    ["cat <<'EOF' > notes.txt\npwsh\nEOF", "shellscript"],
    ["", "shellscript"],
    // Windows agents also run PowerShell directly, without a pwsh wrapper.
    ["Get-Content package.json | Select-String version", "powershell"],
    ["$env:CI='1'; npm test", "powershell"],
    ["$tmp = Join-Path $env:TEMP repo; git clone example", "powershell"],
    ['"=== CHECK FILE ==="; Get-Content file.txt', "powershell"],
    ["& 'C:\\Python312\\python.exe' -c 'print(1)'", "powershell"],
    ["Install-Module Pester -Scope CurrentUser", "powershell"],
    ["ConvertTo-Json @{ a = 1 }", "powershell"],
    ["update-alternatives --list java", "shellscript"],
    ["install-info --version", "shellscript"],
    ["Make-Thing now", "shellscript"],
    ["echo Get-Content; git status", "shellscript"],
    ["FOO=1 npm test", "shellscript"],
    ["echo $HOME && ls", "shellscript"],
  ])("%s", (command, language) => {
    expect(commandHighlightLanguage(command)).toBe(language);
  });
});

it("makes controls visible without changing tabs or CRLF", () => {
  expect(withVisibleControlCharacters("echo \u001b[31mred\u0007\u007f\r\n\tend")).toBe(
    "echo ␛[31mred␇␡\r\n\tend",
  );
});
