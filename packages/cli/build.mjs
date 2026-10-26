import { chmodSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeThirdPartyNotices } from '../extension/third-party-notices.mjs';

const esbuild = createRequire(new URL('../extension/package.json', import.meta.url))('esbuild');
mkdirSync('out', { recursive: true });
const result = await esbuild.build({
    entryPoints: ['src/command.ts'],
    outfile: 'out/tonto-view.js',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    banner: { js: '#!/usr/bin/env node' },
    metafile: true
});
chmodSync('out/tonto-view.js', 0o755);

const notices = writeThirdPartyNotices([result.metafile], 'out/THIRD-PARTY-NOTICES.txt', {
    ownPackageRoots: [resolve('.'), resolve('../view'), resolve('../canvas'), resolve('../extension')],
    description: 'The tonto visualizer CLI bundles the following packages into out/tonto-view.js.'
});
console.log(`CLI bundle complete; notices for ${notices} bundled packages.`);
