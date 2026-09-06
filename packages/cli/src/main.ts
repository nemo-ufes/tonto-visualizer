/**
 * What the diagram would draw, as JSON, without drawing it.
 *
 * The extension and this command derive the same view model from the same
 * session, so a diagram that comes out wrong can be examined here -- in a diff,
 * in a test, in CI -- rather than by squinting at a picture.
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DisplayOptions, LayoutOptions } from 'tonto-view';
import { defaultDisplayOptions, defaultLayoutOptions, derive } from 'tonto-view';
import { ViewSession } from 'tonto-view/session';
import { autoLayout, darkTheme, placeNewNodes, render, sizeOf } from 'tonto-canvas';

const usage = `tonto-view <file-or-directory> [--package <name>]...

Prints the view model -- the nodes, edges, groups and generalization sets a
diagram of the model would hold.

  --svg              draw it, rather than describing it
  --dark             the dark theme, with --svg
  --layout <name>    layered (default), stress, mrtree, radial, force
  --routing <name>   straight (default) or orthogonal
  --direction <dir>  DOWN (default) or RIGHT
  --loose            lay the model out as one graph, ignoring its packages
  --package <name>   restrict the view to this package; repeatable
  --no-external      leave out elements from packages outside the view
  --no-datatypes     leave out datatypes and enumerations
`;

export async function run(argv: string[]): Promise<number> {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        process.stdout.write(usage);
        return argv.length === 0 ? 2 : 0;
    }

    const packages: string[] = [];
    let showExternalReferences = true;
    let showDatatypes = true;
    let asSvg = false;
    let dark = false;
    let algorithm: LayoutOptions['algorithm'] = defaultLayoutOptions.algorithm;
    let routing: DisplayOptions['routing'] = defaultDisplayOptions.routing;
    let direction: LayoutOptions['direction'] = defaultLayoutOptions.direction;
    let groupByPackage = defaultLayoutOptions.groupByPackage;
    const paths: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]!;
        if (argument === '--package') {
            const name = argv[index + 1];
            if (!name) {
                process.stderr.write('--package needs a package name\n');
                return 2;
            }
            packages.push(name);
            index += 1;
        } else if (argument === '--no-external') {
            showExternalReferences = false;
        } else if (argument === '--no-datatypes') {
            showDatatypes = false;
        } else if (argument === '--svg') {
            asSvg = true;
        } else if (argument === '--dark') {
            dark = true;
        } else if (argument === '--layout') {
            algorithm = argv[++index] as LayoutOptions['algorithm'];
        } else if (argument === '--routing') {
            routing = argv[++index] as DisplayOptions['routing'];
        } else if (argument === '--direction') {
            direction = argv[++index] as LayoutOptions['direction'];
        } else if (argument === '--loose') {
            groupByPackage = false;
        } else {
            paths.push(argument);
        }
    }

    const target = resolve(paths[0] ?? '.');
    // A model is the directory its files sit in, because half of what a diagram
    // draws is declared in a neighbouring file.
    const folder = statSync(target).isDirectory() ? target : resolve(target, '..');
    const session = new ViewSession({ workspace: [folder] });
    const models = await session.models();
    const all = statSync(target).isDirectory() ? models : await session.modelsOf(pathToFileURL(target).toString());

    const view = derive({
        models: all.length > 0 ? all : models,
        documentation: session.documentation(),
        options: {
            showExternalReferences,
            showDatatypes,
            ...(packages.length > 0 ? { includedPackages: packages } : {})
        }
    });

    if (!asSvg) {
        process.stdout.write(JSON.stringify(view, undefined, 2) + '\n');
        return 0;
    }

    // Nothing is placed here -- a command line has no saved arrangement -- so
    // this is the picture a view gets the first time it is opened: laid out
    // automatically, and afterwards the modeller's to move.
    const display: DisplayOptions = { ...defaultDisplayOptions, routing };
    const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
    const laid = await autoLayout(view, sizes, placeNewNodes(view, sizes, {}), {
        ...defaultLayoutOptions,
        algorithm,
        direction,
        routing,
        groupByPackage
    });
    const drawn = render({
        view,
        positions: laid.positions,
        routes: Object.fromEntries(Object.entries(laid.routes).map(([id, points]) => [id, { points }])),
        display,
        ...(dark ? { theme: darkTheme } : {})
    });
    process.stdout.write(drawn.svg + '\n');
    return 0;
}
