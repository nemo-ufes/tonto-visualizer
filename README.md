# tonto-visualizer

An OntoUML diagram beside the text, in VS Code: a `.tonto` model drawn as you
type it, and **arranged by hand** — elements dragged where you want them, and
left there when the model changes.

It is used together with the Tonto language extension from
[`nemo-ufes/tonto`](https://github.com/nemo-ufes/tonto), which
supplies the grammar, the checks and the language server. This repository
supplies the picture, and draws it itself: no PlantUML, no Graphviz, no
rendering server, nothing sent anywhere.

See [docs/PLAN.md](docs/PLAN.md) for the original design notes. Work after the
first complete release is tracked in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Status

Working end to end.

- `packages/view` — reads Tonto models into diagram nodes, edges, package groups
  and generalization sets. It keeps stable ids across edits and draws unresolved
  names while the model is incomplete.
- `packages/canvas` — lays out and draws the diagram as SVG. It supports
  straight, curved and right-angle routes. Automatic layout leaves positioned
  elements where the modeller put them.
- Ontology manifests with a `bundles` clause appear as UML package diagrams.
  Double-click a package to open its class diagram.
- `packages/cli` — `tonto-view <file-or-directory> [--svg]`.
- `packages/extension` — redraws as you type, keeps the last valid diagram when
  the model has errors, and supports navigation, filters, manual arrangement,
  export, and saved named views.

The notation includes stereotypes, attributes, datatypes, enumerations,
generalizations and generalization sets, relations, cardinalities, role names,
whole-part diamonds, `instanceOf` and `derivedFrom`. A multiplicity of `1` is
omitted; other relation-end multiplicities omit brackets, while attribute
multiplicities keep them.

The diagram edits the saved view, not the `.tonto` model.

## Command line

Install the standalone CLI with Node.js 22 or later:

```sh
npm install --global @nemo-ufes/tonto-visualizer-cli
tonto-view path/to/model.tonto --svg > diagram.svg
```

Without `--svg`, `tonto-view` prints the diagram's JSON view model. See the
[CLI package guide](packages/cli/README.md) for local installation and options.
To use the CLI alongside the Tonto language server in Vim or Neovim, see the
[Vim and Neovim guide](docs/VIM-NEOVIM.md).

## Getting started

    git clone --recurse-submodules https://github.com/nemo-ufes/tonto-visualizer
    cd tonto-visualizer
    npm run language     # builds tonto-language, in vendor/
    npm install
    npm run build
    npm test

    node packages/cli/bin/tonto-view.js packages/canvas/test/fixtures/university

    npm run dev:install  # build, package and install a development VSIX

Development builds, versioning and releases follow tonto's own procedure; see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

With a diagram open, **Tonto: Save Diagram as Named View** copies its current
content and arrangement to a named file such as
`views/employment.core-taxonomy.tontoview`. **Tonto: Open Diagram View**
switches between that model's default and named views.
Renaming or moving a model in VS Code takes its views along, in the same
edit as the rename, so undoing the rename puts them back too.

The Tonto language is a pinned submodule under `vendor/` and is consumed as-is.

## Acknowledgements

This project reimplements and extends visualization features of the [legacy tonto project](https://github.com/nemo-ufes/tonto-legacy), which was mainly authored by Matheus Lenke Coutinho at the [NEMO Ontology & Conceptual Modeling research group](https://nemo.inf.ufes.br) under supervision of João Paulo A. Almeida at the Federal University of Espírito Santo (UFES), Brazil.

tonto's language design, concrete syntax, and OntoUML/UFO semantics are the work of the [NEMO Ontology & Conceptual Modeling research group](https://nemo.inf.ufes.br), in cooperation with the [Semantics, Cybersecurity & Services (SCS) group](https://www.utwente.nl/en/eemcs/scs/) throughout various research projects, which have received among others the support of CNPq, CAPES and FAPES over the years.

We also acknowledge the ongoing contributions of Giancarlo Guizzardi, Tiago
Prince Sales, Claudenir M. Fonseca, and the contributors to
[OntoUML](https://github.com/OntoUML).

## Licence

MIT. See [LICENSE](LICENSE).
