# Tonto visualizer CLI

Render Tonto models as SVG or print the diagram's view model as JSON, without
opening VS Code. The CLI uses the same model derivation and drawing code as the
Tonto visualizer extension.

Requires Node.js 22 or later.

```sh
npm install --global @nemo-ufes/tonto-visualizer-cli
tonto-view path/to/model.tonto --svg > diagram.svg
```

Install it in a project instead, then use `npx tonto-view`:

```sh
npm install --save-dev @nemo-ufes/tonto-visualizer-cli
npx tonto-view path/to/model.tonto
```

Without `--svg`, the command prints the visualizer's JSON view model. Pass a
directory to load the models in a workspace, or a `.tonto` file to inspect its
diagram. Ontology manifests with a `bundles` clause are rendered as package
diagrams.

Use `tonto-view --help` for package filters, display modes, routing options and
saved `.tontoview` arrangements.
