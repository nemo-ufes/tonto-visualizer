# Directions for agents

This repository draws Tonto models. The language they are written in lives
elsewhere and is read, not reimplemented.

## Commands

    npm run language     # build vendor/tonto's tonto-language (needed once, and after bumping the pin)
    npm install
    npm run build
    npm test
    npm run dev:install  # package and install a development build (docs/DEVELOPMENT.md)

## Layout

| | |
|---|---|
| `vendor/tonto` | the language ([`nemo-ufes/tonto`](https://github.com/nemo-ufes/tonto)), as a pinned git submodule. **Never edited from here.** |
| `packages/view` | the AST read as a diagram: nodes, edges, groups, gensets. No DOM, no `vscode`. |
| `packages/canvas` | sizes, placement, routing, SVG. Runs in a webview and in Node; `./draw` is the half that does not need ELK. |
| `packages/extension` | the VS Code panel: host in `src`, the canvas app in `src/webview` |
| `packages/cli` | `tonto-view`, which prints a view model or draws it |
| `scripts` | versioning, development installs and releases -- see `docs/DEVELOPMENT.md` |
| `docs/PLAN.md` | what is being built, and the decisions behind it |

## The rules this repository is built on

- **Use the language for model semantics.** Ask `tonto-language` which natures
  a class classifies, whether a relation is a parthood, and which end holds the
  whole. Do not derive those facts here. `packages/view/src/language.ts` is the
  one file that names the coupling.
- **An id is what the model says, not where it is written.** A saved position
  outlives the session and must survive the text moving around it. Ids come from
  `ids.ts`, never from an array index or a line number.
- **The arrangement belongs to the modeller.** Adding a class must not move
  anything already placed. Automatic layout fills gaps; it does not overrule.
- **The picture survives a broken parse.** A model is unparseable for most of
  the time somebody is typing in it. Draw what still resolves, keep the rest,
  and say what is wrong somewhere that is not the middle of the canvas.
- **The derivation is testable without a screen.** `packages/view` has no DOM
  and no `vscode` import, so what a diagram holds is a golden file and a diff.
- **Look at the picture.** Layout and drawing defects are invisible in the
  markup and obvious in a render. `node packages/cli/bin/tonto-view.js <model>
  --svg` draws one; every defect fixed here so far -- labels behind boxes,
  cardinalities printing on top of each other, routes landing in the corner of
  the canvas -- passed review as code and was caught by looking.

## What other projects load from here

The panel also runs outside VS Code: a page can host it as the extension does,
by loading its script into its body and answering its messages. The
`exports` map in `packages/extension/package.json` names what such a page
uses -- the built script and stylesheet, `src/webview/skeleton.ts`,
`src/protocol.ts`, `src/restoration.ts` and `src/filters.ts` -- and that is a
promise to code outside this repository, which updates by moving a pin and
finds out what changed when its build breaks.

- Change the panel's body only in `skeleton.ts`; the extension and the tests
  both load it from there.
- A change to `protocol.ts` -- a message renamed, a field made required -- is
  a breaking change for every host, not only the extension. Add rather than
  rename where you can, and say so in the commit message where you cannot.
- `test/webview.test.ts` drives the panel through a stand-in host exactly as
  another page does. Keep it passing.
- Keep the exported modules free of `vscode`. The language is reached only
  through `tonto-language/core`, whose few Node imports such a page stands in
  for.

## House style

- Comments say why, not what: the reason a table has a hole in it, the defect a
  guard exists for, the thing that was tried and did not work.
- 4-space indent, ESM, `tsc -b`, vitest, no default exports.
- Domain examples must be true. A fixture that says a car is part of an engine
  teaches the wrong thing, and the fixtures are read more often than the code.
- The tracked version is the last release's, and the workspaces share it:
  never stamp or bump it by hand. `npm run dev:install` makes a development
  version without touching it; `npm run release:prepare` is the only way it
  moves.
- Verify by running. Every fixture in `packages/view/test/fixtures` validates in
  silence under `tonto check`; keep it that way.
