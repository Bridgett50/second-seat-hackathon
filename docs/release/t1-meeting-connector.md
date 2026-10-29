# T1 meeting connector

Protocol: `meeting-connector/1`.

Hackathon parent: `77b79b87d28b2d928282e7bce093004462310785`.
Original twin, read-only and not a git parent: `31ca1b05a010c3c89493fddfbcb9deeb57d80af8` in `loving-grace-holo-demo`.

The connector is not mounted on the web server. Production dispatch throws `production-dispatch-disabled`. Tests inject principals. There is no public owner-id header.

`.muse/scope.txt` is absent. This record does not add that file. A minimal allowlist, if one is later authorized, would be:

```text
services/bot/src/meeting/**
services/bot/test/meeting-connector.test.ts
docs/release/t1-meeting-connector.md
```

Real Meet, OAuth, Gmail, Glimmer, Spark, voice, and avatar remain unverified. Offline plumbing is not proof of those.
