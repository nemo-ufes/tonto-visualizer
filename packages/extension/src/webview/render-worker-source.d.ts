/**
 * The bundled text of `render-worker.ts`, put here by the build (`esbuild.mjs`).
 *
 * Carried inside the panel's own script, rather than fetched beside it, so the
 * panel's content policy has to admit nothing more than a worker made from a
 * blob.
 */
declare module 'render-worker-source' {
    export const source: string;
}
