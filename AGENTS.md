# Directions for agents

This repository draws Tonto models. The language they are written in lives
elsewhere and is read, not reimplemented.

## Commands

    npm run language     # build vendor/tonto's tonto-language (needed once, and after bumping the pin)
    npm install
    npm run build
    npm test
    npm run dev:install  # package and install a development build (docs/DEVELOPMENT.md)

## Release publication fallbacks

- If Marketplace or npm publication fails, report the failing step and its
  concrete error, then give the user copyable terminal steps for the failed
  registry. A successful GitHub Release does not mean those publications
  succeeded.
- Use the exact `.vsix` and `.tgz` attached to that version's GitHub Release.
  Do not rebuild or repack them for manual publication. The usual asset names
  are `tonto-visualizer-<version>.vsix` and
  `nemo-ufes-tonto-visualizer-cli-<version>.tgz`.
- After the GitHub Release is created, download its VSIX to the repository
  root so the release binary remains available locally:

      gh release download "v$VERSION" --pattern "tonto-visualizer-$VERSION.vsix" --dir .

  Set `VERSION` to the release version first. Root-level `.vsix` files are
  ignored by `.gitignore`.
- For the first public npm release, direct the user to authenticate with
  `npm login --auth-type=web` and check `npm whoami`. Download the exact tarball
  to a temporary directory and publish it with `--access public`:

      mkdir -p "/tmp/tonto-visualizer-$VERSION"
      gh release download "v$VERSION" --pattern "nemo-ufes-tonto-visualizer-cli-$VERSION.tgz" --dir "/tmp/tonto-visualizer-$VERSION"
      npm publish "/tmp/tonto-visualizer-$VERSION/nemo-ufes-tonto-visualizer-cli-$VERSION.tgz" --access public

  Once that package exists, npm Trusted Publishing can be configured for
  organization `nemo-ufes`, repository `tonto-visualizer`, workflow
  `release.yml`, with direct publishing enabled. Do not claim provenance for a
  manual publish.
- If Marketplace OIDC publishing fails, explain whether the `nemo-ufes`
  Trusted Publishing policy is missing or mismatched. Give the policy fields:
  repository owner `nemo-ufes`, repository `tonto-visualizer`, workflow
  `release.yml`, and no environment unless the workflow is changed to use
  one. For a terminal fallback, have the user run
  `npx --yes @vscode/vsce@^4.0.2 login nemo-ufes` so the CLI prompts for the
  Marketplace PAT, then
  `npx --yes @vscode/vsce@^4.0.2 publish --packagePath "./tonto-visualizer-$VERSION.vsix" --skip-duplicate`.
- Keep credentials out of the repository. Never write or ask the user to paste
  npm tokens, Marketplace PATs, GPG passphrases, private keys, or other secret
  values into tracked files, command arguments, logs, or chat. Let the relevant
  CLI prompt the user locally.
- If `git tag -s` fails with a pinentry TTY error, advise the user to run the
  signing command in their normal interactive terminal after setting and
  exporting the actual terminal and updating the running GPG agent:

      export GPG_TTY="$(tty)"
      gpg-connect-agent updatestartuptty /bye
      git tag -s "v$VERSION" -m "Release v$VERSION"

  Do not ask for the passphrase in chat or add it to the repository.

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
