# A minimal IAP v0.1 host, built from the spec alone: report

The question: is IAP (RFC 0003, "Intents and Persistence", v0.1 draft) easy to implement?

What I did: I built a library-neutral host core in TypeScript on bun, using `jsonata` 2.2 and `ajv` 8.
I added a conformance runner and two renderers (HTML and terminal). I worked only from
`docs/rfcs/0003-intents-and-persistence.md`, `docs/spec/schema/*.json`,
`docs/spec/catalogs/kumo-2.17.json`, `docs/spec/README.md` and the 28 fixtures. Those spec
artifacts are copied verbatim into `spec/`. **I never opened the repo's `src/`, `worker/` or
`shared/`.** When the spec was ambiguous, I inferred the answer from the fixtures, and each of
those inferences is listed below.

## 1. Fixtures passed: 28 of 28

```
$ bun run conformance
  change    7/7    change-01-apply, -02-stale, -03-missing-target, -04-invalid-result,
                   -05-template-and-alias, -06-worked-example, -07-derived-requirements
  intent    5/5    intent-01-alias, -02-alias-incompatible, -03-materialize,
                   -04-prompt-is-part-of-key, -05-worked-example
  render    7/7    render-01 … render-07 (incl. -07-worked-example)
  validate  9/9    validate-01 … validate-09
28 of 28 fixtures passed      (L1: 20/20, L2: 8/8)
```

There are no failures to explain. I also checked that the runner can actually fail. I copied the
fixtures to a temp directory and changed five expectations: a render row value, a validate issue
substring, the derived `itemFields` of a change, the order of intent candidates, and a view
`error` flag. The runner reported exactly those 5 as FAIL (23/28). To reproduce, point
`IAP_FIXTURES=<dir>` at a mutated copy.

Caveats, so this isn't overclaimed:

- **Passing the fixtures is not the same as being L1/L2 conformant.** §13 says an L1 host "runs
  `set`, `close`, `navigate`, `refresh` and `research`", and there are no fixtures for action
  execution. **I did not build an action runtime**, so the renderers only emit actions as data.
  The fixtures also don't cover toolbars, a hidden root, missing required params, research cache
  misses, `layoutOps`, `putPage`/`removePage`, `setToolbar`, `setAlias: null`, html URL rules,
  `childLimits`, the gatekeeper, or `stale` inputs.
- Seven extra `bun test` cases (`tests/extra.test.ts`) cover some of those gaps against my own
  reading of the RFC. They all pass, but they test my interpretation, not the author's.
- **Most of the validate and change fixtures pass partly because I worded my error messages to
  contain the fixtures' substrings.** See friction item F1.

## 2. Spec friction (for the spec author)

These are ordered roughly by how much they would trip up an independent implementer.

**F1. Issue text is normative in the fixtures but not specified anywhere.** Six fixtures check
for exact phrases in the host's messages. The RFC doesn't define any of this wording, so a host
with correct but differently worded messages fails them:

| Fixture | Expected phrase |
|---|---|
| validate-04 | `"isn't a slot"` |
| validate-05 | `"doesn't declare"` |
| validate-06 | `"$random() isn't allowed"` |
| validate-03 | `"source cycle"` |
| change-02 | `"stale baseVersion"` |
| change-03 | `'no block "nope"'` |

validate-02 and change-04 depend on the `unknown source "<id>"` form. I matched them because I
read the fixtures before writing the messages. Suggestion: give issues stable codes plus
arguments (e.g. `{code:"unknown-source", source:"missing"}`) and match on those.

**F2. Accepted documents are expected in "defaults-applied" form, and the schema can't produce
that form.**
- change-01, -05, -06 and -07 expect `params: {}` on pages and `ui: {}` on blocks. They also
  expect `frame: {style:"card",title:true,sources:true,freshness:true}` on **every block**,
  including blocks the change didn't touch.
- `document.schema.json` has no `default` on `Block.frame`, only on the properties inside
  `BlockFrame`. I got the frame default from the fixture.
- §11.3 never says the stored document is normalized. A host that stores exactly what was
  written fails 4 change fixtures.
- The `Source` defaults (`args`, `preferSources`, `params`) sit inside `oneOf`, where standard
  validators don't apply defaults (ajv's `useDefaults` ignores `oneOf`/`anyOf`). I had to
  hand-write `defaults.ts`.
- Suggestion: either state "hosts store the normalized form" and add `default: {}` to
  `Block.frame`, or drop normalization from the fixtures' expected documents.

**F3. Props schemas vs bindings (§7.1, §7.2).**
- §7.2's catalog-field table says `props` is a schema "for the node's props *after* bindings are
  resolved". But validation (§7.2 MUST, §12.2) happens at authoring time, before any data exists.
- How should `{"label":{"path":"/x"}}` be checked against Button's required `label: string`?
  render-01 binds `Stat.hint` (a `string` prop), so bindings must be legal anywhere.
- I wrapped every property subschema as `anyOf: [original, PathRef]`. That makes RecordForm's
  explicit `DynamicValue` redundant, and the catalog becomes inconsistent about whether bindings
  are declared or implicit. Please state the rule.

**F4. What counts as a binding (§7.1, §5.2)?** The `PathRef` schema allows extra keys, so is
`{"path":"/x","label":"y"}` a binding? §5.2 reserves "a literal object with a single `path` key".
I treat only objects whose sole key is `path` as bindings, so a data object that happens to have
a `path` field stays data. Please say which reading is right.

**F5. The resolved-tree shape (§8.3) exists only in the fixtures.**
- These rules are inferred from render-04, not stated in the RFC:
  - output is `{root, nodes}`;
  - dropped nodes disappear from `nodes`;
  - `visible` is removed once it has been evaluated, but kept when it reads `$item`;
  - `children` are filtered.
- Not covered by text or fixtures: what happens when the root itself is hidden (I return
  `root: null`), the toolbar's shape, and whether an empty `children` stays as `[]`.
- **Mixed conditions are unspecified.** For example, `{"and":[{"path":"/ui/x"},{"path":"$item/y"}]}`
  is "left as is" under step 3. The per-item pass then also has to evaluate `/ui/x`, so per-item
  resolution needs the block scope, not just the item.
- "Missing values are undefined (the key is omitted)" doesn't say what happens to a binding that
  is an array element.

**F6. The fixture format's `error: true` (render-03) isn't documented.** The README says "only
the keys present in `expect` are compared", but a message can never equal `true`. I treat it as
"a non-empty error message is present".

**F7. "Newest first" for candidates (§10.1 step 3) has no clock.** Templates have no timestamp.
intent-04 implies array order, with the last entry being newest. It's also unspecified whether
`putTemplate` on an existing id keeps its position or counts as newest. I keep the position.

**F8. Derived requirements (§10.2).**
- change-07 implies `itemFields`/`tools` are **sorted** and that `$item` reads in action params
  count. Neither is stated.
- change-07 also keeps `tpl-old.itemFields: ["name"]`, even though its tree reads `$item/title`.
  So derivation happens only on `putTemplate`, and stored templates can be inconsistent.
- intent-02 then treats `tpl-old` as compatible with `{name}`, and that template would render
  with a missing title.
- Should validation re-derive or reject stale `itemFields`?

**F9. Research on first use vs "never on load" (§5.4 vs §11.2).**
- §5.4: with new param values the host is "researching them once on first use".
- §5.4 also says the host "MUST NOT re-research on load", and §11.2 says models are "never"
  called "on load, navigation". A first-use research call happens *during a load*.
- Also unspecified: what status the result has while waiting (I return `loading`), and whether
  `fetchedAt` is `asOf` or `researchedAt`.

**F10. Expression inputs (§5.2).** `view.expr` gets `{}` as its input (§6). For `args`, `when`
and `normalize`, the bindings are specified but the input (`$`) for `args` and `when` isn't. I
used `{}`. Input aliases also share a namespace with `$route` and the clock overrides
(`$now`, `$millis`); an input alias named `route` would shadow `$route`.

**F11. §5.5 rule 3, "any input … isn't `ok`".** A `stale` input therefore errors its dependents.
That's probably unintended, since stale data is still data.

**F12. `/ui` persistence has no write path.**
- §8.1 says `/ui` state "is part of the document and persists", and that dismissing writes
  `null` to it (§8.2).
- But the change schema has no op for writing a block's `ui`; only a full `putBlock` would do it.
- And every accepted change bumps `version` (§11.4), so does each checkbox click create a new
  version?

**F13. Bound controls are pointers, not bindings.** `Checkbox.bind`, `TextInput.bind` and
`DataTable.selectionBind` are strings, so resolution correctly leaves them alone. But then the
resolved tree doesn't contain the values a renderer has to draw. `BlockSources` and
`BlockUpdated` have the same problem with `/meta`. "The renderer consumes only the resolved
tree" therefore isn't quite true; my `ResolvedPage` carries a small `state` map and `meta` for
this. The RFC should say what a binding receives besides the tree.

**F14. Small gaps.**
- The default page is "the first page in key order" (§4), but JSON key order isn't preserved by
  every language or parser.
- Whether a root node is subject to `parent` rules (a DialogAction as root) is unstated. I
  reject it.
- The 1 s expression timeout (§5.6) can't really be enforced in-process. JSONata's CPU work is
  synchronous, so mine is a best-effort `Promise.race`, and a true bound needs a worker or isolate.
- render-05 depends on JSONata 2.x's default `$now()` format including milliseconds
  (`…12:00:00.000Z`). That's fine, but it means "JSONata 2.x" is load-bearing.

**F15. The catalog leaves presentation semantics to prose.**
- **Formats:** `compact`, `relative` and `date` have no locale, timezone or reference clock
  defined. For `relative` I used `asOf`, and for `count` on a non-array I picked a rule myself.
- **Selection:** what `selectionBind` stores isn't defined (I assumed rowKey values).
- **Kumo layout rules:** RecordForm-in-Dialog moving its submit button to the footer, and
  DialogAction "on the right", exist only in description prose.
- §11.2's determinism covers resolved trees, not formatted text, so two hosts will show
  different strings. That's allowed, but worth saying.

## 3. Easy, hard, over-specified

**Easy:**
- Source evaluation order, memoization, failure isolation and `when`.
- Collection wrapping (§5.1): it explains why `items.{…}` with one item still yields a list,
  which is a nice touch.
- The alias key, compatibility, the change op semantics and the version check.
- JSONata's bindings API makes the deterministic clock and the `$random()` trap about 10 lines.
- Once the shape was known, resolution was about 100 lines.
- I wrote the core in one pass, and all 28 fixtures passed on the first run.

**Hard (or only easy because the fixtures exist):**
- Getting the resolved-tree shape, the defaults-normalized document and the issue wording
  right, all of which come from fixtures rather than prose (F1, F2, F5).
- Validating props when bindings are present (F3).
- Without the fixtures, I'd estimate 5–8 of the 28 would have failed on a first attempt from the
  RFC text alone. That's an estimate, not measured.

**Over-specified:**
- Not much in the behavior. The `frame` block and the Kumo-specific prose in a
  "library-neutral" catalog are the closest.
- The catalog descriptions mention "Kumo LayerDialog", "a bottom sheet on mobile" and
  "LayerDialog.Action". That's useful for a model prompt, but it's binding detail inside the
  neutral catalog.

**Under-specified, relative to what L1 claims:** action execution (§9) has no fixtures, and
`/ui` writes have no op (F12).

## 4. Catalog-agnostic verdict

**Mostly yes for structure and data, partly for presentation.**
- The core contains zero component-specific code apart from reading `children`, `parent`,
  `childLimits`, `action` and `overlay` from the catalog.
- Both renderers consume the same resolved trees, and no document changed between them.
- The terminal renderer maps all 18 types, but these were lossy or awkward:
  - **Popover, ActionMenu and DialogAction's split menu** need a floating, interactive panel.
    In static text I draw the trigger (`[Columns ▾]`, `[⋯]`, `[[ Save ▾ ]] (also: …)`) and list
    the contents as footnotes under the block.
  - **Dialog** is an overlay; I draw it inline as a double-line box with the dismiss and
    primary buttons in a footer row. "Closing fires `close`" and "bottom sheet on mobile" have
    no terminal meaning.
  - **DataTable row actions** (whole row clickable): I number the rows (`1›`) and print the
    intent once (`row ↵: intent "…"`). Cell templates work fine through the per-item pass.
  - **Stack `direction: row`** with multi-line children needs horizontal joining, plus a
    fall-back to a column when it doesn't fit. Its `align` is mostly ignored.
  - **`className` and `grid` on html nodes** (Tailwind and Kumo tokens) mean nothing in a
    terminal and are ignored. A document that relies on them for meaning (e.g. an emphasis
    colour) loses it.
  - **Variants** (Badge, Text, Button) become text markers: `(! Ship)`, `✓`, `[[ primary ]]`.
  - **BlockSources and BlockUpdated** need `/meta`, which isn't in the tree (F13).
- Not exercised: interaction (typing into a TextInput, toggling checkboxes, firing actions).
  Both renderers are static. A real TUI binding would need focus handling and an action runtime.

## 5. Lines of code (`wc -l`, TypeScript; some lines are long, especially in html.ts)

| Part | Files | Lines |
|---|---|---|
| Core | `src/core/*.ts` + `src/index.ts` (validate 280, load 209, change 133, resolve 118, intents 113, page 71, expr 71, util 54, defaults 43, index 7) | **1,099** |
| Conformance runner | `conformance/run.ts` | **83** |
| HTML renderer | `src/renderers/html.ts` (incl. ~25 lines of CSS) | **188** |
| Terminal renderer | `src/renderers/terminal.ts` | **283** |
| Shared renderer helpers | `src/renderers/common.ts` (formats, columns, per-row cells) | 63 |
| Example script / extra tests | `scripts/render-examples.ts` / `tests/extra.test.ts` | 63 / 74 |

Dependencies: `jsonata`, `ajv`, and `typescript` (dev, for `tsc --noEmit`, which passes).

## 6. Outputs (`out/`)

Each rendered fixture has `.resolved.json` (the library-neutral input), `.html` and `.txt`:

- `render-07-worked-example` is the §15 page. `…overlay.*` is the §15 template for the PR row.
  It was produced by running `invokeIntent` end to end: the first click goes `via materialize`,
  using a stub materializer that returns the RFC's template with bogus
  `itemFields: ["ignored"]`. The host re-derived `["author","title","url"]`, applied the change
  (doc v3 → v4), and the second click went `via alias`. One model call in total.
- Also rendered: render-01 (tool source), render-03 (failure isolation, showing the per-block
  error state), render-04 (visibility plus `$item` cell templates) and render-06 (research).
- `showcase.*` is my own document (`examples/showcase.json`, which validates) using **all 18
  catalog types**, plus `showcase.overlay.*`.

What's verified: the HTML is tag-balanced (checked with a parser), and the terminal output was
inspected by eye. **I have not visually checked the HTML in a browser**, because the sandbox has
none.

Run it yourself: `bun install && bun run conformance && bun test && bun run render-examples`.

## 7. Effort

- About 45 assistant tool-call rounds, counted by hand; exact tokens and cost come from the traces.
- Reading the spec and fixtures took about 9 rounds.
- The core plus the runner took about 12 rounds; everything passed on the first run.
- The renderers, examples and output fixes took about 15 rounds.
- Testing, type-checking and this report took the rest.
- One round was wasted creating and deleting a VM for a browser check I then didn't do.
