# 167. Resolve Content transport configuration once

Status: accepted, 2026-10-02. Consolidates the configuration rules of
[ADR 0077](0077-content-collections.md) under the loopback-only backend boundary
established by [ADR 0091](0091-shared-access-and-direct-tailnet-ingress.md).

Content, Server startup, Access forwarding and the UI must use one side-effect-free
Content transport configuration contract in `packages/api`. These consumers
already depend on the shared transport package; resolving settings must not load
a Content context, open storage or start a listener.

The contract owns listener defaults, port validation, current-before-legacy
environment precedence, the fixed loopback host, and paired, canonical, distinct
HTTP(S) public origins. The documented `STACK_WIKI_PORT` and
`STACK_WIKI_ARTIFACT_PORT` settings remain valid when their `STACK_CONTENT_*`
replacements are absent. Zero requests an ephemeral listener; it is not a usable
destination inferred by a client.

Public link origins and backend destinations are separate facts. Access always
forwards to the configured loopback listener, regardless of public origins. UI
link generation uses the same validation and offers no link when its destination
cannot be resolved. Content's listener can report its actual bound ephemeral
address after startup; environment-only readers cannot invent that address.

This removes duplicated validation and the obsolete non-loopback Content-host
branches. Access remains the remote authentication and ingress owner. Existing
Content identities, cited paths and persisted state retain their contracts.
