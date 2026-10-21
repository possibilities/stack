# 188. Preserve local browser sessions across ordinary Server restart

Status: accepted, 2026-10-21. Updates the browser startup policy in ADRs 0113 and 0146.

## Decision

An ordinary Server restart does not revoke an authenticated local browser. The
Server calls `LocalAuth.rotateForStartup({ preserveBrowserSessions: true })` only
after claiming its socket. The shared transaction rotates HTTP operator authority,
deletes pending bootstrap links and WebSocket tickets, removes expired sessions,
and retains unexpired UI and Inspector sessions with their original origin,
audience, digest and absolute expiry.

The UI already obtains a fresh single-use WebSocket ticket from its HttpOnly cookie
on each reconnect. After restart that exchange continues to work, so an existing
authenticated tab can reconnect or reload without another `stack serve open`.
Neither restart nor reconnect extends the eight-hour session lifetime. Old HTTP
operator credentials and Access backend assertions remain invalid after startup;
private stdio launch authority retains its existing independent lifecycle.

Logout still revokes the selected session and its child tickets. Explicit
`stack serve revoke-local` rotates both operator credentials and deletes all local
capabilities. Factory reset still removes local authority state. These boundaries,
expiry, and exact origin/audience checks remain effective across subsequent
restarts. No anonymous authentication endpoint or persistent plaintext browser
token is introduced.

The independent Client host has its own LocalAuth store and startup policy. The
new session-preservation option is explicit at the Server call site; the default
continues to invalidate browser capabilities for other owners. Remote Access
session and refresh policy is unchanged.

## Consequences and verification

Routine maintenance no longer requires repeated terminal authentication while a
local browser session remains valid. Restart is no longer an implicit local
browser sign-out; use logout or explicit revocation when sign-out is intended.
Sessions already revoked by an older Server cannot be recovered by this change.

Disposable-state tests cover preservation across reopened authority handles,
unchanged expiry, origin/audience separation, pending link/ticket invalidation,
HTTP credential rotation, logout and explicit revocation. A gateway restart test
uses the original browser cookie to obtain a new ticket and execute an operation,
then verifies explicit revocation closes the connection and denies further tickets.
No Package API schemas, transports or new UI controls are required.
