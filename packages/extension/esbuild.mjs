// Two bundles, because they run in two places: the extension host is Node with
// `vscode` provided, and the panel is a browser with neither. Both are bundled
// so the packaged extension carries the language, the derivation and the
// renderer with it and needs nothing installed alongside. The panel's bundle
// carries a third inside it: the worker it draws large diagrams in.
import * as esbuild from 'esbuild';
import { resolve } from 'node:path';
import { writeThirdPartyNotices } from './third-party-notices.mjs';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

/**
 * `render-worker-source`: the panel's drawing worker, bundled on its own and
 * handed to the panel's script as a string, from which it makes a blob worker.
 *
 * Built inside the panel's build, and its inputs reported as the panel's, so
 * watching the panel also rebuilds the worker when the canvas changes.
 */
const renderWorker = {
    name: 'render-worker-source',
    setup(build) {
        build.onResolve({ filter: /^render-worker-source$/ }, args => ({ path: args.path, namespace: 'render-worker' }));
        build.onLoad({ filter: /.*/, namespace: 'render-worker' }, async () => {
            const result = await esbuild.build({
                entryPoints: ['src/webview/render-worker.ts'],
                bundle: true,
                write: false,
                platform: 'browser',
                target: 'es2022',
                format: 'iife',
                metafile: true,
                minify
            });
            return {
                contents: `export const source = ${JSON.stringify(result.outputFiles[0].text)};`,
                loader: 'js',
                watchFiles: Object.keys(result.metafile.inputs).map(input => resolve(input))
            };
        });
    }
};

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
        minify,
        plugins: [renderWorker]
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
