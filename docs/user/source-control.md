# Source Control Integrations

Ronin connects to your Git hosting provider so you can create pull requests, review code, and manage repositories without leaving the app.

## Supported Providers

Ronin works with the platforms your team already uses:

- **GitHub** – Pull requests, repository creation, and clone integration
- **GitLab** – Merge requests, repository publishing, and hosted clones
- **Forgejo and Gitea** – Pull requests and repository workflows through `fj` or `tea`
- **Bitbucket** – Pull request workflows (via API token authentication)
- **Azure DevOps** – Pull request support for Microsoft-hosted repositories

GitHub requests use its API directly. Ronin chooses credentials in this order: a token saved in Settings → Source Control → GitHub, the server's GH_TOKEN (or GH_ENTERPRISE_TOKEN with GH_HOST for Enterprise), then the GitHub CLI login. Saved tokens stay in the environment's secret store. You can choose the CLI account for each host or turn a host off in the same settings panel. A saved token or environment token takes precedence over the account choice.

## What You Can Do

### Start Projects from Anywhere

**Start from a name**

- Choose **New project** in the command palette (`Cmd/Ctrl + K`), or choose **Add Project → New project**
- Type a name. Ronin creates a Git repository in the `projects` folder of that environment's Ronin data directory, with a README, an icon, and an initial commit, then opens a new thread
- Choose **Create private repository on GitHub** to publish it there too. If Git has no name or email configured, the project still opens without the initial commit

**Clone repositories directly**

- Open the Command Palette (`Cmd/Ctrl + K`) → **Add Project**
- Choose **GitHub repository**, **GitLab repository**, **Forgejo / Gitea repository**, **Bitbucket repository**, **Azure DevOps repository**, or paste any **Git URL**
- Enter the repository path (`owner/repo`, `group/project`, `workspace/repository`, or `project/repository`) or a full Git URL, pick a destination, and start coding

**Publish local projects to the cloud**

- Have a local Git repository without a remote?
- Use the **Publish Repository** action to create a new hosted repository (GitHub, GitLab, Forgejo, Gitea, Bitbucket, or Azure DevOps), add it as your origin remote, and push, in one flow
- If the local repository has no commits yet, publishing creates the remote and wires it up but does not push. Make a commit, then push normally.

### Manage Code Reviews Without Context Switching

**Create pull requests while you work**

- Push a branch and create a pull request from the Git actions controls in the toolbar
- Ronin can suggest titles and descriptions based on your commits
- With **Repository conventions** selected, generated source control text follows the project's
  `AGENTS.md` along with recent commit subjects. Claude writers also follow `CLAUDE.md`
- Supports GitHub Pull Requests, GitLab Merge Requests, Bitbucket Pull Requests, and Azure DevOps Pull Requests

Commit-message previews preserve both staged and unstaged changes, including partially staged
files. If you already staged changes, a commit without an explicit file selection keeps that
selection; with nothing staged, Ronin stages the current changes as before.

**Stay on top of open reviews**

Agents can list, link, or unlink a pull request on another thread on the same machine, including
one in another project. Without an explicit target, these actions use the agent's own thread.
Changing another thread's links requires an active turn and cannot exceed the calling thread's
permission mode; an agent in plan mode can change links only on other plan-mode threads.

Enable **Remove agent credits when merging** in Settings → Source Control to remove recognized
agent co-author and generated-by lines from GitHub merge and squash commit messages. Human
co-authors stay credited. It is off by default. Project Settings → Checkout lets each checkout
override its environment's default or return to it. This also applies to auto-merge, but excludes
merge queues and native stack merges. Original commits retain their messages.

- See if your current branch already has an open PR/MR
- When an agent finishes a turn on your thread's branch, Ronin checks for a newly opened
  PR/MR if background activity is enabled for that repository. Known reviews keep their normal
  refresh schedule.
- Hold **Shift** on the pull request list or a thread's pull request toolbar to reveal quick
  **Close**, **Merge**, **Ready for review**, or **Reopen** actions. These act immediately. Stacked pull requests require opening their detail
  panel to merge the stack.
- In the GitHub list, drag from **Close** across rows in the same group and release to close
  several reviews. Press **Escape** before releasing to cancel. Failed closes remain available
  to retry, and queued actions continue after a failure.
- Open several reviews from the **Pull requests** page as tabs in the right panel
- Your authored reviews stay at the top and use the selected sort within their group. By default,
  see passing and approved reviews first, passing reviews awaiting approval next, and conflicting
  reviews last. Smaller changes come first within each readiness group, and finished reviews follow
  open work when all states are visible.
- Filter the list by author or labels, rank authors by merges in the loaded results, see label and
  change-size context on each row, and sort the results currently shown by readiness, update time,
  creation time, or change size. Your filters, search, scope, and sort are restored when you return.
- Merge now, or on GitHub, GitLab, and Azure DevOps, leave an auto-merge instruction with a chosen
  strategy while checks are outstanding; see the completed state in the same control after the
  pull request merges
- On GitHub, approve fork workflows that are waiting to run and open a revert pull request for a
  merged change
- Timeline line counts stay hidden on merge commits, where GitHub's totals include upstream changes
  brought in from the base branch
- While working in a thread, open linked reviews in the same compact right-panel tabs without
  leaving the conversation
- Show a file tree next to a review's **Code** tab, or a thread's **Diff** panel, to browse the
  changed files as folders and jump straight to any of them. The toolbar toggle remembers your
  choice.
- Enable **Settings → General → Proactive panels** to open a newly linked review automatically and
  switch to the completed turn's diff when agent work finishes
- Open the review directly in your browser with one click
- If Ronin cannot load a GitHub pull request, including when GitHub rate limits requests, use
  **Open on GitHub** in the error view
- Command-click (Control-click on Windows and Linux) a pull request number in the sidebar to open it
  in your browser instead of in Ronin
- Check out a teammate's branch to review code locally

**Fix what you wrote, in place**

- Comment while closing an open pull request or reopening a closed one when the host offers that
  action
- Rewrite a pull request's title and description from the review itself, in Markdown, with a
  preview before you save
- Rewrite your own comments the same way, wherever they are shown
- Works on GitHub, GitLab, and Bitbucket. Azure DevOps takes a new title and description; its
  comments stay read-only here, as they already were
- On GitHub, put a label on a pull request or take one off from the **Labels** row of the review.
  Changing labels needs triage access or better on the repository

### Know Your Setup at a Glance

The **Source Control settings** page shows you exactly what's connected:

- ✅ Which providers are authenticated and ready
- ⚠️ What's missing and how to fix it
- 👤 Which account is signed in (when available)

Run a quick **Rescan** after setting up a new machine or changing credentials.

GitHub sharing is off by default. In **Settings → Connections → GitHub sharing**, choose **Read PRs** or **Read and
act** for each environment you trust to share GitHub access. Enable both the original environment
and the environment answering its requests on this client. **Read and act** can use broader GitHub
permissions than the original environment's credential; only enable it for environments you
control and trust. Changing a saved endpoint or removing an environment clears its permission.

GitHub review details, linked PR status, and permitted review actions can then use another
connected environment signed in to the same GitHub account. Each needs a project on that host.
A connected local environment is preferred for actions and can answer slow or failed reads.
Credentials stay on their machines. Previously verified credentials remain usable for routing for
ten minutes during a GitHub outage; new credentials must be verified first. An action with an
uncertain result is never automatically retried elsewhere. Listings, diffs, and checkout or PR
creation from Git actions continue to use the project's environment.

## Getting Started

### For GitHub (Recommended for most users)

1. Install the GitHub CLI (version 2.81.0 or newer) on the machine running Ronin:
   ```bash
   brew install gh
   ```
2. Sign in:
   ```bash
   gh auth login
   ```
3. Open **Settings → Source Control** in Ronin and verify GitHub shows as authenticated

You can now clone, publish, and create pull requests.

### For Forgejo and Gitea

Install [Forgejo CLI (`fj`)](https://codeberg.org/forgejo-contrib/forgejo-cli) or
[Gitea CLI (`tea`)](https://gitea.com/gitea/tea) 0.16 or later on the machine running Ronin. Sign
in with `fj --host https://your-server auth add-token` or `tea login add`, then rescan **Settings →
Source Control**. Repeat for each server you use, including Codeberg.

Ronin prefers a matching `fj` login and falls back to `tea`. Servers hosted under a URL subpath use
`tea`, because `fj` 0.6 does not preserve that subpath during account checks. Use a full repository
URL when more than one server is configured; Git pushes and clones also need normal Git credentials
or an SSH key for that server.

### For GitLab

1. Install the GitLab CLI:
   ```bash
   brew install glab
   ```
2. Authenticate:
   ```bash
   glab auth login
   ```
3. Check **Settings → Source Control** to confirm the connection

### For Bitbucket

Open **Settings → Source Control**, expand **Bitbucket**, and choose how to sign in:

- **Access token:** a token scoped to one repository, project, or workspace.
- **API token:** an Atlassian account token used with your email. Give it read/write access to
  repositories and pull requests, plus user read access (`read:user:bitbucket`).

Choose **Save**. Credentials are stored on the selected environment's server and apply immediately,
including on a remote environment. Saved tokens cannot be viewed again; enter a new value to
replace one, or choose **Remove**.

If no credentials are saved, Ronin uses environment variables on the server as a fallback. Restart
the server after changing them:

```bash
export T3CODE_BITBUCKET_ACCESS_TOKEN="your-access-token"
# or
export T3CODE_BITBUCKET_EMAIL="you@example.com"
export T3CODE_BITBUCKET_API_TOKEN="your-token"
```

### For Azure DevOps

1. Install Azure CLI:
   ```bash
   brew install azure-cli
   ```
2. Add the DevOps extension:
   ```bash
   az extension add --name azure-devops
   ```
3. Sign in:
   ```bash
   az login
   ```

---

## Requirements & Troubleshooting

**Git is required** – Ronin uses Git for all local operations. Ensure `git` is installed on your server.

**Server-side setup** – Authentication happens on the machine running Ronin (the server), not your local browser. If you're using a hosted or team instance, your administrator may have already configured providers.

**Common issues:**

- **Provider shows "Not authenticated"** – Run the login command for that provider (e.g., `gh auth login`) in a terminal on the server, then rescan in Settings
- **GitHub says it could not verify sign-in status** – Ronin needs GitHub CLI 2.81.0 or newer to check sign-in status. Update `gh` (e.g., `brew upgrade gh`), then rescan
- **Bitbucket not connecting** – Double-check your environment variables are set in the correct shell profile and the server was restarted
- **Can't push to a remote** – Verify your Git remote URL matches the provider you've authenticated with (SSH vs HTTPS remotes may need different credentials)

**Need more help?** Check your provider's CLI documentation:

- [GitHub CLI](https://cli.github.com/)
- [GitLab CLI](https://gitlab.com/gitlab-org/cli)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/)

## Linked pull requests

Cross-repository links use a project on the same host. Azure DevOps reviews require a project checked
out from the matching organization and repository.

Clicking a thread badge with more than one linked review opens its **Linked pull requests** panel.

## GitHub stacks

The Pull Requests page shows each PR's position in its GitHub stack. Open the stack badge in a
review to navigate its layers. **Merge stack** submits the selected pull request and every unmerged
layer below it to GitHub together, respecting branch rules and merge queues. The confirmation shows
the scope and merge strategy. GitHub rebases the remaining stack after merging.

**Rebase stack** updates remote branches from bottom to top without changing your local checkout.
It can rewrite history and restart checks. If a layer fails, earlier updates remain; resolve that
layer before retrying. GitHub may require manual conflict resolution after a lower layer is amended,
even when its changes look independent. Stack actions require an environment that supports them.
