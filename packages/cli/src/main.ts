/**
 * What the diagram would draw, as JSON, without drawing it.
 *
 * The extension and this command derive the same view model from the same
 * session, so a diagram that comes out wrong can be examined here -- in a diff,
 * in a test, in CI -- rather than by squinting at a picture.
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContentOptions, DerivedMaterialMode, DisplayOptions, LayoutOptions, ViewFile } from 'tonto-view';
import {
    defaultDisplayOptions, defaultLayoutOptions, derive, derivePackages, packageName, packagesInScope,
    readViewFile, reconcile
} from 'tonto-view';
import { modelRoot, ViewSession } from 'tonto-view/session';
import { autoLayout, darkTheme, placeNewNodes, render, sizeOf } from 'tonto-canvas';

const usage = `tonto-view <file-or-directory> [--package <name>]...

Prints the view model -- the nodes, edges, groups and generalization sets a
diagram of the model would hold. An ontology manifest -- an "ontology"
header with a "bundles" clause -- is drawn as a package diagram instead: its
packages, the ontologies it imports, and the dependencies between them.

  --svg              draw it, rather than describing it
  --view <file>      render saved positions, routes and options from a .tontoview file (with --svg)
  --dark             the dark theme, with --svg
  --routing <name>   straight (default), curved or orthogonal
  --direction <dir>  DOWN (default) or RIGHT
  --taxonomy-only    draw names and inheritance, without attributes or associations
  --partonomy-only   draw names, whole-part relations and constitution, ranked whole
                     above part, with the specializations parts inherit them through
  --loose            lay the model out as one graph, ignoring its packages
  --package <name>   restrict the view to this package; repeatable
  --no-external      leave out elements from packages outside the view
  --no-datatypes     leave out datatypes and enumerations
  --derived-material <mode>  both (default), relators, or relations
`;

export async function run(argv: string[]): Promise<number> {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        process.stdout.write(usage);
        return argv.length === 0 ? 2 : 0;
    }

    const packages: string[] = [];
    let showExternalReferences = true;
    let showDatatypes = true;
    let derivedMaterialMode: DerivedMaterialMode | undefined;
    let asSvg = false;
    let dark = false;
    let taxonomyOnly = false;
    let partonomyOnly = false;
    let routing: DisplayOptions['routing'] = defaultDisplayOptions.routing;
    let direction: LayoutOptions['direction'] = defaultLayoutOptions.direction;
    let groupByPackage = defaultLayoutOptions.groupByPackage;
    let viewPath: string | undefined;
    let routingSpecified = false;
    let directionSpecified = false;
    let groupByPackageSpecified = false;
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
        } else if (argument === '--view') {
            const name = argv[index + 1];
            if (!name) {
                process.stderr.write('--view needs a .tontoview file\n');
                return 2;
            }
            viewPath = name;
            index += 1;
        } else if (argument === '--no-external') {
            showExternalReferences = false;
        } else if (argument === '--no-datatypes') {
            showDatatypes = false;
        } else if (argument === '--derived-material') {
            const mode = argv[index + 1];
            if (mode !== 'both' && mode !== 'relators' && mode !== 'relations') {
                process.stderr.write('--derived-material needs both, relators, or relations\n');
                return 2;
            }
            derivedMaterialMode = mode;
            index += 1;
        } else if (argument === '--hide-derived-relators') {
            // Kept as an alias for views scripted against the earlier option.
            derivedMaterialMode = 'relations';
        } else if (argument === '--svg') {
            asSvg = true;
        } else if (argument === '--dark') {
            dark = true;
        } else if (argument === '--taxonomy-only') {
            taxonomyOnly = true;
        } else if (argument === '--partonomy-only') {
            partonomyOnly = true;
        } else if (argument === '--routing') {
            routing = argv[++index] as DisplayOptions['routing'];
            routingSpecified = true;
        } else if (argument === '--direction') {
            direction = argv[++index] as LayoutOptions['direction'];
            directionSpecified = true;
        } else if (argument === '--loose') {
            groupByPackage = false;
            groupByPackageSpecified = true;
        } else if (argument.startsWith('-')) {
            process.stderr.write(`Unknown option: ${argument}\n`);
            return 2;
        } else {
            paths.push(argument);
        }
    }

    if (taxonomyOnly && partonomyOnly) {
        process.stderr.write('--taxonomy-only and --partonomy-only rank by different hierarchies; choose one\n');
        return 2;
    }

    if (viewPath && !asSvg) {
        process.stderr.write('--view can only be used with --svg\n');
        return 2;
    }

    let saved: ViewFile | undefined;
    if (viewPath) {
        try {
            saved = readViewFile(JSON.parse(readFileSync(resolve(viewPath), 'utf8')));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Could not read view file ${viewPath}: ${message}\n`);
            return 2;
        }
    }

    const target = resolve(paths[0] ?? '.');
    // A model is more than the file, because half of what a diagram draws is
    // declared in a neighbouring one -- or, for a bundled package, in the
    // manifest a directory up.
    const folder = statSync(target).isDirectory() ? target : modelRoot(target);
    const session = new ViewSession({ workspace: [folder] });
    const models = await session.models();
    const all = statSync(target).isDirectory() ? models : await session.modelsOf(pathToFileURL(target).toString());
    const outline = statSync(target).isDirectory() ? undefined : await session.outline(pathToFileURL(target).toString());

    const content: ContentOptions = saved ? {
        ...saved.content,
        ...(showExternalReferences ? {} : { showExternalReferences: false }),
        ...(showDatatypes ? {} : { showDatatypes: false }),
        ...(derivedMaterialMode ? { derivedMaterialMode } : {}),
        ...(packages.length > 0 ? { includedPackages: packages } : {})
    } : {
        scope: 'file',
        showExternalReferences,
        showDatatypes,
        showGensets: true,
        derivedMaterialMode: derivedMaterialMode ?? 'both',
        ...(packages.length > 0 ? { includedPackages: packages } : {})
    };
    const fileModels = all.length > 0 ? all : models;
    const view = outline ? derivePackages(outline) : derive({
        models: saved ? models : fileModels,
        documentation: session.documentation(),
        options: saved
            ? {
                ...content,
                includedPackages: packagesInScope(content, {
                    file: packageNames(fileModels),
                    workspace: packageNames(models)
                })
            }
            : content
    });

    if (!asSvg) {
        process.stdout.write(JSON.stringify(view, undefined, 2) + '\n');
        return 0;
    }

    // A saved view owns its appearance and layout; explicit CLI switches remain
    // useful for trying a variation without editing the file.
    const display: DisplayOptions = {
        ...defaultDisplayOptions,
        ...(saved ? saved.display : {}),
        ...(routingSpecified || !saved ? { routing } : {}),
        ...(taxonomyOnly || !saved ? { taxonomyOnly } : {}),
        ...(partonomyOnly || !saved ? { partonomyOnly } : {})
    };
    const layout: LayoutOptions = {
        ...defaultLayoutOptions,
        ...(saved ? saved.layout : {}),
        ...(directionSpecified || !saved ? { direction } : {}),
        ...(groupByPackageSpecified || !saved ? { groupByPackage } : {})
    };
    if (display.taxonomyOnly && display.partonomyOnly) {
        process.stderr.write('The saved view enables both taxonomy-only and partonomy-only; choose one\n');
        return 2;
    }
    const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
    const savedArrangement = saved ? reconcile(saved, view) : undefined;
    const positions = placeNewNodes(view, sizes, savedArrangement?.placed ?? {});
    const laid = savedArrangement?.unplaced.length
        ? await autoLayout(view, sizes, positions, {
            ...layout,
            routing: display.routing,
            taxonomyOnly: display.taxonomyOnly,
            partonomyOnly: display.partonomyOnly,
            packageContainers: display.showPackageGroups,
            only: savedArrangement.unplaced
        })
        : saved ? undefined : await autoLayout(view, sizes, positions, {
            ...layout,
            routing: display.routing,
            taxonomyOnly: display.taxonomyOnly,
            partonomyOnly: display.partonomyOnly,
            packageContainers: display.showPackageGroups
        });
    const drawn = render({
        view,
        positions: laid?.positions ?? positions,
        routes: {
            ...(laid
                ? Object.fromEntries(Object.entries(laid.routes).map(([id, points]) => [id, { points }]))
                : {}),
            ...(routingSpecified ? {} : savedArrangement?.routed ?? {})
        },
        display,
        direction: layout.direction,
        ...(dark ? { theme: darkTheme } : {})
    });
    process.stdout.write(drawn.svg + '\n');
    return 0;
}

function packageNames(models: Awaited<ReturnType<ViewSession['models']>>): string[] {
    return [...new Set(models.flatMap(model => model.packages
        .map(packageName).filter((name): name is string => name !== undefined)))];
}
