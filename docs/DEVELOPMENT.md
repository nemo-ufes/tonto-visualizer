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
then bundles the extension host (`out/extension.cjs`) and the webview
(`out/webview.js`) with esbuild, and writes `out/THIRD-PARTY-NOTICES.txt` from
what esbuild bundled. It stops if a bundled package declares no license or one
outside the permissive list in `packages/extension/third-party-notices.mjs`;
elkjs is the one package taken, by name, under a copyleft license (EPL-2.0).

Open this repository in VS Code and press `F5` to launch the Extension
Development Host. The launch runs the root build first, so the host draws with
the code on disk. It does not rebuild the language: run `npm run language`
after moving the submodule.

## Local installation and releases

There are two intentional workflows: install a development build locally, or
publish a release. A local installation must not change the version selected
for the next release. A release gives the extension and the workspaces bundled
into it -- `tonto-view`, `tonto-canvas` and `tonto-view-cli` -- one shared
SemVer version, because they ship as one thing. The extension's version is the
reference the others must match, and `npm run versions:check` (run in CI)
checks that they and the lockfile agree.

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

The developer communicates release intent by choosing a version, reviewing the
version change, and dispatching the `Release tonto visualizer` workflow by
hand. Pushing a tag does not start a release. The workflow's Marketplace
option defaults to off, so a GitHub-only release needs no registry
credentials.

1. Choose the SemVer release, for example `0.2.0`.
2. Run `npm run release:prepare -- 0.2.0`. It sets the version in every
   workspace's `package.json` and in the lockfile, and verifies they agree. It
   does not publish anything.
3. Review and commit the version change and the release-ready source,
   including the language submodule at the commit the release is built
   against: the release is built from that pin, not from tonto's `main`.
4. Create a signed, annotated tag at that commit and push it. Check first that
   the commit being tagged carries the version, since the workflow refuses a
   tag that does not match:

   ```sh
   git status --short                   # nothing left uncommitted
   npm run versions:check -- v0.2.0
   git tag -s v0.2.0 -m "Release v0.2.0"
   git push origin v0.2.0
   ```

   Pushing the tag does not run the release workflow.
5. In GitHub Actions, select `Release tonto visualizer` and choose **Run
   workflow**. Enter the tag and leave **Publish extension to the VS Code
   Marketplace** unchecked for a GitHub-only release. The workflow verifies the
   signed tag and the versions, builds, typechecks and tests the tagged commit
   with its pinned language, packages `tonto-visualizer-<version>.vsix`, and
   attaches it to the GitHub Release.

The signed tag identifies the release source; the GitHub Release is the
download page. The workflow requires the `RELEASE_SIGNING_PUBLIC_KEY` secret
and the `RELEASE_SIGNING_FINGERPRINT` variable even when publishing only to
GitHub. Protect the `v*` tag namespace and accept only the trusted release
signer. Before enabling Marketplace publication, configure trusted publishing
for the `nemo-ufes` Marketplace publisher and this workflow; no long-lived
publishing token is used. The workflow skips a version the Marketplace already
has.

A release of this extension does not have to coincide with one of tonto's:
the extension bundles its own copy of the language, at the pinned commit, for
drawing. Moving the pin is an ordinary change, released with the next version.
