import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // The worker's bundled text is made by esbuild.mjs. The tests draw
            // in the page, so an empty worker stands in for it.
            'render-worker-source': fileURLToPath(new URL('test/render-worker-source.ts', import.meta.url))
        }
    }
});
