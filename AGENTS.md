# Directions for agents

This repository draws Tonto models. The language they are written in lives
elsewhere and is read, not reimplemented.

## Commands

    npm run language     # build vendor/tontoredesign's tonto-language (needed once, and after bumping the pin)
    npm install
    npm run build
    npm test

## Layout

| | |
|---|---|
| `vendor/tontoredesign` | the language, as a pinned git submodule. Private, so a clone needs credentials for it and CI needs the `LANGUAGE_TOKEN` secret. **Never edited from here.** |
| `packages/view` | the AST read as a diagram: nodes, edges, groups, gensets. No DOM, no `vscode`. |
| `packages/canvas` | sizes, placement, routing, SVG. Runs in a webview and in Node; `./draw` is the half that does not need ELK. |
| `packages/extension` | the VS Code panel: host in `src`, the canvas app in `src/webview` |
| `packages/cli` | `tonto-view`, which prints a view model or draws it |
| `docs/PLAN.md` | what is being built, and the decisions behind it |

## The rules this repository is built on

- **The language is the authority.** Anything about what a model *means* --
  which natures a class classifies, whether a relation is a parthood, which end
  holds the whole -- is asked of `tonto-language` and never re-derived here. A
  picture that disagrees with the validator is worse than no picture.
  `packages/view/src/language.ts` is the one file that names the coupling.
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

## House style

- Comments say why, not what: the reason a table has a hole in it, the defect a
  guard exists for, the thing that was tried and did not work.
- 4-space indent, ESM, `tsc -b`, vitest, no default exports.
- Domain examples must be true. A fixture that says a car is part of an engine
  teaches the wrong thing, and the fixtures are read more often than the code.
- Verify by running. Every fixture in `packages/view/test/fixtures` validates in
  silence under `tonto check`; keep it that way.
