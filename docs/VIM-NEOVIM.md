# Tonto in Vim and Neovim

Use the Tonto language server for editor features, and the visualizer CLI to
render diagrams. They are separate programs: the language server provides
diagnostics and other LSP features, while `tonto-view` writes a diagram as SVG
or JSON. The CLI does not attach to Vim or update a diagram live.

The Tonto language server is published as [`tonto-language`](https://github.com/nemo-ufes/tonto),
and the visualizer is published as
[`@nemo-ufes/tonto-visualizer-cli`](https://www.npmjs.com/package/@nemo-ufes/tonto-visualizer-cli).
Both require Node.js 22 or later.

## Install the tools

For a machine-wide installation:

```sh
npm install --global tonto-language @nemo-ufes/tonto-visualizer-cli
```

Check that both commands are on your `PATH`:

```sh
command -v tonto-language-server
tonto-view --help
```

If your shell or editor cannot find the global commands, use their full paths
or install them in the project and point your editor's `cmd` setting at
`./node_modules/.bin/tonto-language-server`:

```sh
npm install --save-dev tonto-language @nemo-ufes/tonto-visualizer-cli
```

## Set the filetype to `tonto`

The language server must receive the `tonto` filetype for `.tonto` files.

In Vim, add this to `~/.vim/ftdetect/tonto.vim`:

```vim
autocmd BufRead,BufNewFile *.tonto setfiletype tonto
```

For Neovim, add this to `init.lua`:

```lua
vim.filetype.add({
    extension = {
        tonto = "tonto",
    },
})
```

## Vim with coc.nvim

Open `:CocConfig` and add this entry inside the top-level JSON object. Merge it
with any existing `languageserver` entries:

```json
{
  "languageserver": {
    "tonto": {
      "command": "tonto-language-server",
      "filetypes": ["tonto"],
      "rootPatterns": [".git"]
    }
  }
}
```

Restart Vim or Neovim, then open a `.tonto` file. Use
`:CocCommand document.echoFiletype` to confirm the detected filetype, and
`:CocList services` to check that the Tonto server started.

## Vim with vim-lsp

Add this to your Vim configuration after installing
[`vim-lsp`](https://github.com/prabirshrestha/vim-lsp):

```vim
if executable('tonto-language-server')
    augroup tonto_lsp
        autocmd!
        autocmd User lsp_setup call lsp#register_server({
            \ 'name': 'tonto-language-server',
            \ 'cmd': {server_info->['tonto-language-server']},
            \ 'allowlist': ['tonto'],
            \ })
    augroup END
endif
```

Open a `.tonto` file and check `:LspStatus` (if provided by your vim-lsp
version) or `:messages` for startup errors.

## Neovim built-in LSP (0.11 or later)

Put this in `~/.config/nvim/lsp/tonto.lua`:

```lua
return {
    cmd = { "tonto-language-server" },
    filetypes = { "tonto" },
    root_markers = { ".git" },
}
```

Enable the config in `init.lua`:

```lua
vim.lsp.enable("tonto")
```

Open a `.tonto` file and run `:checkhealth vim.lsp` to inspect the active
configuration and attached clients. Neovim's built-in `vim.lsp.config()` and
`vim.lsp.enable()` APIs are available starting with Neovim 0.11.

### LazyVim

For current LazyVim releases based on Neovim 0.11+, create
`lua/plugins/tonto.lua` in your LazyVim configuration:

```lua
return {
    {
        "neovim/nvim-lspconfig",
        opts = {
            servers = {
                tonto = {
                    cmd = { "tonto-language-server" },
                    filetypes = { "tonto" },
                    root_markers = { ".git" },
                },
            },
        },
    },
}
```

Use the same Neovim filetype rule above. LazyVim versions before 15 use
different LSP setup conventions; follow the configuration docs for the
version installed.

### AstroNvim and other Neovim distributions

AstroNvim supports custom servers through its AstroLSP configuration. Add
`tonto` to its `lsp.servers` list and define `cmd`, `filetypes`, and
`root_markers` for that server in `lsp.config.tonto`. The exact file that
provides those options depends on the AstroNvim version; use its
[custom LSP server guide](https://docs.astronvim.com/recipes/advanced_lsp/).

NvChad and other Neovim configurations can use the built-in Neovim 0.11
configuration above, provided the configuration loads `lsp/tonto.lua` and
enables it with `vim.lsp.enable("tonto")`. Older versions can register the
server through their existing `nvim-lspconfig` setup.

## Render a diagram

From a terminal in the model workspace, write an SVG:

```sh
tonto-view path/to/model.tonto --svg > diagram.svg
```

Pass a directory to render the workspace's models. Without `--svg`, the CLI
prints the JSON view model instead. Use `tonto-view --help` for the available
filters and display options. Open the generated SVG in a browser or image
viewer to inspect it.

## Troubleshooting

- Confirm `node --version` reports 22 or later.
- Confirm `.tonto` buffers have filetype `tonto` (`:set filetype?` in Vim or
  Neovim; `:CocCommand document.echoFiletype` with coc.nvim).
- Confirm the editor can find `tonto-language-server`. GUI-launched editors
  sometimes have a different `PATH` from the terminal.
- Open the project directory as the workspace so the LSP client can find its
  `.git` root marker.
- Use `tonto-view --help` to check CLI options; the diagram command runs in the
  terminal and is independent of the LSP connection.

## References

- [Tonto language and language server](https://github.com/nemo-ufes/tonto)
- [Neovim LSP documentation](https://neovim.io/doc/user/lsp.html)
- [coc.nvim language server settings](https://github.com/neoclide/coc.nvim/blob/master/doc/coc-config.txt)
- [vim-lsp server registration](https://github.com/prabirshrestha/vim-lsp#registering-servers)
- [LazyVim LSP setup](https://www.lazyvim.org/plugins/lsp)
