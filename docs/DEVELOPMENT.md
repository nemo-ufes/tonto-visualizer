# Developing tonto visualizer

This guide covers building, installing a development build, and releasing.
What is being built and why is in [PLAN.md](PLAN.md); the rules the code
follows are in [AGENTS.md](../AGENTS.md). The procedures here follow tonto's
own ([`docs/development.md`](https://github.com/nemo-ufes/tonto/blob/main/docs/development.md)),
so the two repositories install and release the same way.

## Build and test

The build requires Node.js 22 or later. Installing the VSIX to use the
diagram in VS Code does not.

```sh
git submodule update --init      # the language, under vendor/tonto
npm run language                 # build tonto-language; again after moving its pin
npm install
npm run build
npm run typecheck
npm test
```

`npm run build` compiles `tonto-view`, `tonto-canvas` and the CLI with `tsc`,
bundles the CLI into a standalone Node executable, then bundles the extension
host (`out/extension.cjs`) and the webview (`out/webview.js`) with esbuild. Both
bundles get third-party notices from what esbuild included. The build stops if
a bundled package declares no license or one outside the permissive list in
`packages/extension/third-party-notices.mjs`; elkjs is taken under EPL-2.0.

Open this repository in VS Code and press `F5` to launch the Extension
Development Host. The launch runs the root build first, so the host draws with
the code on disk. It does not rebuild the language: run `npm run language`
after moving the submodule.

## Local installation and releases

There are two intentional workflows: install a development build locally, or
publish a release. A local installation must not change the version selected
for the next release. A release gives the extension and the workspaces bundled
into it -- `tonto-view`, `tonto-canvas` and
`@nemo-ufes/tonto-visualizer-cli` -- one shared SemVer version. The CLI is
bundled into a self-contained npm package and built against the same pinned
language as the extension. The extension's version is the reference the others
must match, and `npm run versions:check` (run in CI) checks that they and the
lockfile agree.

### Install a development build

Use F5 for the fastest edit/run loop. Use a packaged local install when
checking the VSIX contents, the DETAILS tab, or the extension running from its
installed location:

1. Save the changes to be exercised.
2. Run `npm run dev:install`.
3. The command builds the workspaces, creates a VSIX with a unique development
   prerelease version (for example, `0.1.63-dev.1792448638407.31349`), and
   installs it. The version is generated for the package; the tracked
   `package.json` files remain unchanged.
4. Reload each VS Code window. An installed package does not replace code
   already loaded by a running extension host, and an open diagram keeps the
   webview script it loaded until its window reloads.

The development version is the next patch after the release version, with a
timestamp and process id in its prerelease identifiers, so it sorts after the
release it was built from and before the next one. The script stamps the
extension's `package.json` only while packaging, and restores it even if
building, packaging or installing fails. The VSIX is left in
`packages/extension` as `tonto-visualizer-<version>.vsix`.

The local install uses the same extension identifier as a released one,
`nemo-ufes.tonto-visualizer`. Use a dedicated VS Code profile or isolated
directories to keep it away from the copy used for normal work: set
`VSCODE_USER_DATA_DIR` and `VSCODE_EXTENSIONS_DIR` before running the command,
and `packages/extension/install-vsix.mjs` passes them to the VS Code CLI. Set
`TONTO_VSCODE_CLI` to use another launcher, such as `code-insiders`.
`npm run install:local` is an alias for `npm run dev:install`.

Builds made before the publisher became `nemo-ufes` were installed as
`tonto-redesign.tonto-visualizer`. VS Code treats that as a different
extension, so uninstall it once, or both will open a diagram panel.

### Prepare and publish a release

Commit the release-ready source to `main` first, including the language
submodule at the commit the release is built against. Then run:

```sh
npm run release -- 0.3.2
```

The script checks that the working tree is clean, local `main` matches
`origin/main`, the version is newer than the current release, the tag is
unused, and `gh` is authenticated. It shows the steps and asks once before it
updates versions, commits them, creates a signed annotated tag, pushes `main`
and the tag, and dispatches `Release tonto visualizer`. Use `--dry-run` to show
the plan without changing the version or repository. Use `--yes` to skip the
confirmation in a deliberate non-interactive run.

The Marketplace and npm options default to off. To publish the VS Code
extension, pass `--publish-marketplace`. For later CLI releases, pass
`--publish-npm`; both can be selected for one release:

```sh
npm run release -- 0.3.2 --publish-marketplace
npm run release -- 0.3.2 --publish-npm  # after the initial npm publication
npm run release -- 0.3.2 --publish-marketplace --publish-npm  # after the initial npm publication
```

For the first npm release, leave `--publish-npm` off. npm only lets a trusted
publisher be configured after a package exists. Once the GitHub release has
finished, download its attached CLI `.tgz` and publish that exact artifact from
an npm-authenticated shell:

```sh
npm publish ./nemo-ufes-tonto-visualizer-cli-0.3.2.tgz --access public
```

Then add a trusted publisher for organization `nemo-ufes`, repository
`tonto-visualizer`, workflow `release.yml`, with direct publishing enabled.
After that, use `--publish-npm` for subsequent releases; GitHub Actions
publishes with provenance. The initial manual publication does not have a
GitHub Actions provenance attestation.

Pushing a tag alone does not start a release. The script dispatches the
workflow after pushing; GitHub Actions verifies the signed tag and versions,
builds, typechecks and tests the tagged commit with its pinned language,
packages `tonto-visualizer-<version>.vsix` and the CLI `.tgz`, and attaches
both to the GitHub Release. When npm publication is selected, the workflow
publishes `@nemo-ufes/tonto-visualizer-cli` with provenance and skips an
existing version only when its integrity matches the artifact. If a step fails,
the script stops there and reports the error; it does not roll back a commit,
tag, or push that already succeeded.

The signed tag identifies the release source; the GitHub Release is the
download page. The workflow requires the `RELEASE_SIGNING_PUBLIC_KEY` secret
and the `RELEASE_SIGNING_FINGERPRINT` variable even when publishing only to
GitHub. Protect the `v*` tag namespace and accept only the trusted release
signer. Before enabling Marketplace publication, configure trusted publishing
for the `nemo-ufes` Marketplace publisher. Before enabling npm publication,
configure npm trusted publishing for `@nemo-ufes/tonto-visualizer-cli` and this
workflow. Neither registry needs a long-lived publishing token; the workflow
skips versions already present with matching contents.

A release of this extension does not have to coincide with one of tonto's:
the extension bundles its own copy of the language, at the pinned commit, for
drawing. Moving the pin is an ordinary change, released with the next version.
