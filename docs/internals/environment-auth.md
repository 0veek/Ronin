# Environment Authentication Profile

> For maintainers. Using Ronin? See [docs/user](../user/).

Environment authorization is capability-based. A session carries zero or more
OAuth-style scope strings:

| Scope                   | Permission                                                      |
| ----------------------- | --------------------------------------------------------------- |
| `orchestration:read`    | Read thread snapshots, events, status, and configuration.       |
| `orchestration:operate` | Send, stop, and change threads and projects.                    |
| `settings:write`        | Change environment preferences and integration credentials.     |
| `providers:manage`      | Configure, install, update, and refresh providers.              |
| `environment:maintain`  | Restart, update, and maintain the environment.                  |
| `source-control:write`  | Write Git state and perform pull request mutations.             |
| `filesystem:read`       | Browse, search, and read workspace files and diffs.             |
| `filesystem:write`      | Edit workspace files.                                           |
| `preview:operate`       | Open and control previews.                                      |
| `diagnostics:read`      | Read diagnostics, resource telemetry, and usage.                |
| `terminal:read`         | Observe existing terminals without opening, input, or resizing. |
| `terminal:operate`      | Create, input, resize, clear, restart, and terminate terminals. |
| `access:read`           | Inspect pairing links and client sessions.                      |
| `access:write`          | Create or revoke pairing links and client sessions.             |

`review:write` is decode-only legacy vocabulary, never an assignable grant. Session responses keep
frozen legacy `scopes` for older clients and advertise actual granular `permissions` to new ones.
Clients prefer `permissions`, including an empty list. Parent-scope fallback is used only with old
servers that do not advertise granular permissions. The server never expands old grants.
Existing sessions stay connected but need to pair again for permissions split out of their grants.

Pairing-link lists and access-stream snapshots and updates contain metadata only.
The raw credential is returned only by the creation request, after the server checks
`access:write` and the delegated scopes. Web and desktop clients keep that response
in memory for sharing. They do not recover credentials from access read models.

Ordinary pairing links grant the standard granular client permissions above, excluding access
administration. Desktop and administrative bootstrap credentials additionally grant
`access:read access:write`. Requested pairing scopes are intersected atomically with the link and
creator grants; a denied or empty exchange does not consume the link. Omitting the scope parameter
inherits the link's grant. Re-pairing in the same browser replaces its prior session atomically.

The desktop derives its bootstrap token from a process-owned secret every 12 hours.
Only that token crosses renderer IPC; the secret travels to the bundled backend over
its bootstrap channel. The backend accepts the previous, current and next window
for clock skew, then grants a 12-hour bearer session. Older desktops retain the
fixed-token fallback. A rotated token refreshes a rejected connection attempt while
an already connected environment keeps its socket and drafts.

## Authentication Flows

### Browser Session

`POST /api/auth/browser-session` consumes a one-time bootstrap credential and creates a
browser session cookie. The cookie is an HTTP transport adapter for the same
scoped session model; the response never exposes the session secret to browser
JavaScript.

### Bearer Access Token

Non-browser clients use `POST /oauth/token` with an
`application/x-www-form-urlencoded` body:

```text
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<bootstrap credential>
subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap
requested_token_type=urn:ietf:params:oauth:token-type:access_token
scope=orchestration:read orchestration:operate filesystem:read terminal:read terminal:operate
```

Clients may additionally submit `client_label`, `client_device_type`, and
`client_os` extension parameters so the authorized-clients UI can identify the
device that established the session. These are presentation hints only; the
environment derives transport metadata such as IP address and user agent from
the request and does not use these fields for authorization.

The response has the token-exchange shape:

```json
{
  "access_token": "<opaque session token>",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "orchestration:read orchestration:operate filesystem:read terminal:read terminal:operate"
}
```

Sessions issued from a plain bearer exchange use the store's
`DEFAULT_SESSION_TTL` of 30 days.

Requested scopes are intersected with the one-time bootstrap credential grant. An empty intersection is denied without consuming it.
An ordinary paired client therefore cannot exchange its grant for
`access:read` or `access:write`.

### Reusable Dev Credential

Web development can opt into a reusable administrative credential by setting a fixed
`T3CODE_DEV_AUTH_TOKEN` of at least 32 characters. The dev runner reads repository env files,
and the worktree setup links the main checkout's gitignored `.env` into new worktrees. Desktop,
production, and non-dev servers ignore this setting.

Open the printed startup pairing URL once per browser profile. It installs a hostname-wide,
port-independent dev cookie, allowing that browser to use later worktree origins without consuming
another one-time link. Each environment still persists its own revocable session record and keeps
its own signing key and database. Rotating the configured token invalidates the prior credential.

Because browsers send cookies to every service on the same hostname, use this only on a hostname
where every service is trusted. The token and startup URL are reusable administrative secrets and
must never be committed or published.

### WebSocket Ticket

`POST /api/auth/websocket-ticket` accepts any authenticated session and returns
a short-lived, single-purpose WebSocket ticket, issued through
`EnvironmentAuth.issueWebSocketTicket` with a five-minute default TTL. The
client presents its bearer credential in headers to get the ticket, then
appends only that ticket to the socket URL as `wsTicket`. This keeps long-lived
tokens and browser cookies out of WebSocket URLs while letting the handshake
authenticate.

The ticket carries its session's scopes; each RPC method then enforces its
granular permissions through `RPC_REQUIRED_SCOPES` in
`apps/server/src/auth/RpcAuthorization.ts`. Review feedback submission dispatches
an orchestration operation, so it requires `orchestration:operate`. Reading
workspace files independently requires `filesystem:read`. Creating a ticket is
not authorization to call every RPC method.

## Standards Alignment

- Bearer access tokens are used through the `Authorization: Bearer` scheme from
  RFC 6750.
- The token endpoint profiles the request and response vocabulary from OAuth 2.0
  Token Exchange (RFC 8693), including `subject_token`, `requested_token_type`,
  `access_token`, `issued_token_type`, and `token_type`.
- Scope values follow the OAuth 2.0 scope model from RFC 6749: space-delimited,
  unordered capabilities with subset checking during exchange.

This is intentionally not a general-purpose OAuth authorization server. The
environment bootstrap token type is private, the bootstrap cookie and WebSocket
connection-token routes are product-specific adapters, and the API returns its
typed `HttpApi` errors rather than implementing every OAuth error response
surface.

## Upgrade Behavior

Migration `031_AuthAuthorizationScopes` is a hard cutover from role-bearing auth
records to scoped records. It deletes existing pairing links and sessions while
leaving non-authentication environment state unchanged. Upgraded clients must
pair again; old `owner` or `client` credentials are never silently mapped to new
capabilities.
