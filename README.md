# trees

A mock-up of the [Intent UI](https://intent-ui.com) idea: one document, six UI trees. Live at [trees.customer0.dev](https://trees.customer0.dev).

Click a row or **Release Checklist** to materialize a lazy intent into the shared document once (v3 to v4). Then switch between Kumo, a terminal, System 7, Swiss print, LCARS and shadcn, or open two side by side: the page is already there, with no new model calls. **Inspect IAP JSON** shows the document as it changes.

A mock-up, not an IAP host: the screens are hand-written, the JSON panel is illustrative and only loosely follows IAP v0.1, the six trees are CSS skins over one component set, model calls are simulated and the data is a fixed fixture. Based on Brayden Wilmoth's [RFC: Intents and Persistence](https://intent-ui.com/rfc).

```sh
npm i
npm run dev
npm run deploy   # Customer 0 account, trees.customer0.dev
```
