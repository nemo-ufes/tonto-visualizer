// Two bundles, because they run in two places: the extension host is Node with
// `vscode` provided, and the panel is a browser with neither. Both are bundled
// so the packaged extension carries the language, the derivation and the
// renderer with it and needs nothing installed alongside.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const contexts = await Promise.all([
    esbuild.context({
        entryPoints: ['src/extension.ts'],
        outfile: 'out/extension.cjs',
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        sourcemap: true,
        minify,
        external: ['vscode']
    }),
    esbuild.context({
        entryPoints: ['src/webview/main.ts'],
        outfile: 'out/webview.js',
        bundle: true,
        platform: 'browser',
        target: 'es2022',
        format: 'iife',
        sourcemap: true,
        minify
    })
]);

if (watch) {
    await Promise.all(contexts.map(context => context.watch()));
    console.log('esbuild watching for changes...');
} else {
    await Promise.all(contexts.map(context => context.rebuild()));
    await Promise.all(contexts.map(context => context.dispose()));
    console.log('esbuild build complete.');
}
