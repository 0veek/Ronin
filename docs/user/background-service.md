# Running Ronin in the Background

On Linux and macOS, Ronin can run as a background service for your user, so it is ready without
keeping a terminal open.

## Manage the Service

Install it with the latest Ronin release:

```sh
npx t3@latest service install
```

Check whether it is installed:

```sh
npx t3@latest service status
```

Update or repair it:

```sh
npx t3@latest service update
```

If an update has been installed but the service is still running the previous version, restart it:

```sh
npx t3@latest service restart
```

The service uses the same Ronin version as the CLI you run. To install a nightly or an exact
version, use that version of the CLI:

```sh
npx t3@nightly service update
npx t3@1.2.3 service update
```

The install and update commands refuse to replace a newer service with an older version. Setup
through onboarding leaves a newer service unchanged. To downgrade, select the exact older version
and pass `--allow-downgrade`:

```sh
npx t3@1.2.3 service update --allow-downgrade
```

Stop it and remove it from startup:

```sh
npx t3@latest service uninstall
```

Updating restarts Ronin briefly. Let active agent work and terminal commands finish first.
If a remote update is already in progress, wait for it to finish before retrying a local update.

The service runs a small stable launcher. Exact Ronin versions are installed separately, so a
failed remote candidate can return to the previous version without rewriting the service
definition. The launcher snapshots the database before a remote candidate starts, so database
updates roll back with the server version. An older launcher may require one local
`service update` before this is available.

## Platform Support

**Linux** uses a systemd user unit at `~/.config/systemd/user/t3code.service`. The service starts
when the machine boots and keeps running after you log out (lingering is enabled during install).

**macOS** uses a launch agent at `~/Library/LaunchAgents/com.t3tools.t3code.service.plist`. It
starts when you log in, not when the Mac boots, and it stops when you log out; macOS has no
equivalent of Linux lingering for user agents. For a Mac that should stay reachable unattended,
turn on automatic login (System Settings → Users & Groups; unavailable while FileVault is on) and
keep the Mac from sleeping.

A few more macOS notes:

- Installing over SSH needs someone logged in at the Mac's screen to start the agent right away.
  Without that, the install command reports an error at the final start step, but the agent is
  fully installed and starts at the next login.
- macOS may show privacy prompts for protected folders such as Desktop, Documents, or Downloads,
  attributed to a bare `node` process, or deny access without a prompt. If agent work fails to
  read those folders, grant Full Disk Access to the node binary listed in the launch agent's
  `ProgramArguments`.
- The agent appears under System Settings → General → Login Items. If it was switched off there,
  or disabled with `launchctl disable`, macOS will not start it at login until you switch it back
  on.

**Windows** is not supported yet.

## Memory pressure on Linux

When a systemd user manager is available, Ronin starts provider processes and terminals in
separate scopes. This lets Linux stop a memory-hungry agent while keeping the environment
server and remote connections available. The scopes share a memory budget: throttling starts
at the larger of half of system RAM or RAM minus 6 GiB; the hard limit is the larger of
three quarters of RAM or RAM minus 4 GiB. For example, an 8 GiB machine throttles above
4 GiB and caps these processes at 6 GiB.

Without a systemd user manager, provider processes and terminals still receive a higher OOM
score so the kernel prefers them over the server, but there is no shared memory cap.
Pi runs inside the server and is outside this isolation. Externally managed OpenCode and
Kilo servers keep their own resource policy. macOS and Windows retain their usual behavior.
