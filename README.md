# trees

One [Intent UI](https://intent-ui.com) document (IAP v0.1), six UI trees. Live at [trees.customer0.dev](https://trees.customer0.dev).

Every screen is rendered from the document by a small IAP host in [`src/iap/host`](src/iap/host): `validate()` → `load()` → resolved tree → binding. The host passes **28 of 28** IAP v0.1 conformance fixtures and was written from the spec and fixtures only. Two bindings are real (HTML and terminal); System 7, Swiss, LCARS and shadcn are CSS skins over the HTML binding.

Click a PR row: the first click materializes the `pr-details` intent into the document (v3 → v4, one simulated model call that answers with the RFC §15 template). Later clicks, and every other tree, resolve through the stored alias with no model call.

Caveats: the model call is simulated, the PR data is a recorded tool call, and only intent, close, navigate and bound checkboxes are wired.

Based on Brayden Wilmoth's [RFC: Intents and Persistence](https://intent-ui.com/rfc). The host's spec friction notes are in [`HOST_REPORT.md`](HOST_REPORT.md).

```sh
npm i
npm run dev
npm run deploy   # Customer 0 account, trees.customer0.dev
```

`src/iap/host` is vendored from the standalone host (commit in `src/iap/HOST_COMMIT`). The only changes: specs are bundled instead of read from disk, and the HTML renderer exports its CSS and body-only helpers.
