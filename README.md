# htmldiff-ts

This is a fork of [htmldiff-js](https://github.com/dfoverdx/htmldiff-js), which is a JavaScript port of [HtmlDiff.NET](https://github.com/Rohland/htmldiff.net), which is itself a C# port of the Ruby implementation, [HtmlDiff](https://github.com/myobie/htmldiff/).

NPM package: [@wesley-edwards/htmldiff-ts](https://www.npmjs.com/package/@wesley-edwards/htmldiff-ts)

## Changes in 1.0.6

Version 1.0.6 fixes invisible diffs when plain text is wrapped or unwrapped in semantic tags such as `eg-condition`. Wrapper insert/delete operations are coalesced and rendered with `structure-change` highlights instead of emitting raw tags.

## Changes in 1.0.5

Version 1.0.5 fixes noisy diffs for formatting-only inline changes (for example bolding one character in `test` → `t<strong>e</strong>st`). When plain text is unchanged, `processReplaceOperation` now renders `format-change` highlights instead of `del.diffmod`/`ins.diffmod` fragmentation.

## Changes in 1.0.4

Version 1.0.4 fixes invisible diffs when only HTML tag attributes change (for example `eg-condition` `tags="..."` updates). Matching still strips attributes to find structural anchors, but `processEqualOperation` now detects attribute-only tag differences and wraps the full new element subtree in `<ins class="diffmod">` without a `<del>` wrapper.

## Changes in 1.0.3

Version 1.0.3 fixes incorrect handling of inline formatting tags (`<strong>`, `<em>`, `<b>`, `<i>`, etc.) inside `insertTag` in `src/Diff.js`. The bug showed up when a **replace** operation ran a delete pass followed by an insert pass on the same region (for example, collapsing a nested list step into flat list text). The diff could emit unbalanced markup such as `</strong></li><strong>`, which made the rest of the document render as bold.

### Root cause

`specialTagDiffStack` tracked open formatting tags while wrapping changed text with `<ins class="mod">` / `<del class="mod">`. The stack was shared across the delete and insert halves of a replace, and closing tags were popped even when they did not match the stack top. On delete, closing tags were sometimes removed from the token stream without being written to the output.

### Fixes (`insertTag`)

| Change | Why |
|--------|-----|
| Reset `specialTagDiffStack` at the start of each `insertTag` call | Prevents state from the delete pass leaking into the insert pass on replace operations |
| Use `<del class="mod">` / `</del>` for delete and `<ins class="mod">` / `</ins>` for insert | Mod wrappers must match the operation type; previously both used `<ins class="mod">` |
| Peek the stack top and only pop when the closing tag matches | Avoids dropping `</strong>` (and similar) on mismatch |
| On delete, strip closing formatting tags only after a successful stack match | Keeps needed closing tags in the output when the stack does not match |

### Build

```bash
npm install
npm run build
```

The package entry point is `dist/htmldiff.min.js`. Use Node 14 when building this project (see `package.json` scripts).
