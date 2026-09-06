# tonto-visualizer

An OntoUML diagram beside the text, in VS Code: a `.tonto` model drawn as you
type it, and **arranged by hand** — elements dragged where you want them, and
left there when the model changes.

It is used together with the Tonto language extension from
[`jpalmeida/tontoredesign`](https://github.com/jpalmeida/tontoredesign), which
supplies the grammar, the checks and the language server. This repository
supplies the picture, and draws it itself: no PlantUML, no Graphviz, no
rendering server, nothing sent anywhere.

See [docs/PLAN.md](docs/PLAN.md) for what is being built and why.

## Status

Early. What works today:

- `packages/view` — a Tonto model read as an explicit diagram: nodes, edges,
  package groups and generalization sets, with ids stable across edits, colours
  from the natures a class actually classifies, and unresolved names drawn
  rather than dropped.
- `packages/cli` — `tonto-view <file-or-directory>`, which prints that view
  model as JSON.

Still to come: the canvas that draws and moves it, and the extension that puts
it beside the editor.

## Getting started

    git clone --recurse-submodules https://github.com/jpalmeida/tonto-visualizer
    cd tonto-visualizer
    npm run language     # builds tonto-language, in vendor/
    npm install
    npm run build
    npm test

    node packages/cli/bin/tonto-view.js vendor/tontoredesign/examples/university

The Tonto language itself is consumed as a pinned submodule under `vendor/`,
never edited from here — one grammar, one set of checks, one answer about what a
model says.

## Licence

MIT. See [LICENSE](LICENSE).
