// Two bundles, because they run in two places: the extension host is Node with
// `vscode` provided, and the panel is a browser with neither. Both are bundled
// so the packaged extension carries the language, the derivation and the
// renderer with it and needs nothing installed alongside.
import * as esbuild from 'esbuild';
import { writeThirdPartyNotices } from './third-party-notices.mjs';

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
        metafile: true,
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
        metafile: true,
        minify
    })
]);

if (watch) {
    await Promise.all(contexts.map(context => context.watch()));
    console.log('esbuild watching for changes...');
} else {
    const results = await Promise.all(contexts.map(context => context.rebuild()));
    await Promise.all(contexts.map(context => context.dispose()));
    const count = writeThirdPartyNotices(results.map(result => result.metafile), 'out/THIRD-PARTY-NOTICES.txt');
    console.log(`esbuild build complete; notices for ${count} bundled packages.`);
}
