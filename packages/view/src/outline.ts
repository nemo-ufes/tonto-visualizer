/**
 * An ontology manifest, read as a package diagram.
 *
 * A manifest -- an `ontology` header with a `bundles` clause -- declares
 * nothing a class diagram could draw: it says which packages make up the
 * ontology, where each is written, and what the ontology imports. So its
 * picture is the UML package diagram of that: the ontology as a package
 * holding its member packages, `use` as a dependency between two of them, and
 * every imported ontology as a package of its own outside.
 *
 * Which package a bundle entry selects and which ontology an import loads are
 * the language's answers, read in `session.ts`; this half takes them as plain
 * data, so the diagram is a golden file and a diff like the class diagram is.
 */

import type { SourceLocation, ViewDependency, ViewEdge, ViewGroup, ViewModel, ViewNode } from './model.js';
import { PACKAGE_COLOR, UNRESOLVED_COLOR } from './palette.js';

/** An `import alias from <location>`, with the ontology it loaded. */
export interface OutlineImport {
    alias: string;
    /** As written, without the angle brackets. */
    location: string;
    /**
     * The ontology the import loaded: an identity that tells two ontologies of
     * one name apart, and the name it declares. Absent when it did not load.
     */
    ontology?: { id: string; name: string };
    /** The import statement. */
    statement?: SourceLocation;
    /** The imported ontology's header, when it is a file that can be opened. */
    header?: SourceLocation;
    documentation?: string;
}

/** A member package: written in the manifest, or bundled from a document of its own. */
export interface OutlinePackage {
    name: string;
    /** The document a bundle entry reads it from; absent for a package written in the manifest. */
    location?: string;
    /** False when the bundle entry selects no package, or one in a document that did not load. */
    available: boolean;
    /** The member packages it uses, each with the statement that says so. */
    uses: Array<{ name: string; statement?: SourceLocation }>;
    /** The ontologies its own document or declaration imports. */
    imports: OutlineImport[];
    source?: SourceLocation;
    documentation?: string;
}

export interface OntologyOutline {
    name: string;
    packages: OutlinePackage[];
    /** The manifest's own imports, which apply to every member. */
    imports: OutlineImport[];
    source?: SourceLocation;
    documentation?: string;
}

/** One ontology in a workspace overview, with the imports resolved by the language. */
export interface WorkspaceOntology {
    name: string;
    identity: string;
    imports: OutlineImport[];
    source?: SourceLocation;
}

export function ontologyGroupId(name: string): string {
    return `ontology:${name}`;
}

export function packageNodeId(name: string): string {
    return `package:${name}`;
}

export function importNodeId(name: string): string {
    return `import:${name}`;
}

export function dependencyId(kind: ViewDependency['stereotype'], client: string, supplier: string): string {
    return `${kind}:${client}->${supplier}`;
}

export function derivePackages(outline: OntologyOutline): ViewModel {
    const frame = ontologyGroupId(outline.name);
    const nodes: ViewNode[] = [];
    const edges: ViewEdge[] = [];
    const edgeIds = new Set<string>();
    const addEdge = (edge: ViewDependency) => {
        // The same dependency stated twice -- a package that imports what the
        // manifest already imports for it, or two spellings of one `use` --
        // is still one dependency, and the first statement is the one opened.
        if (!edgeIds.has(edge.id)) {
            edgeIds.add(edge.id);
            edges.push(edge);
        }
    };

    for (const one of outline.packages) {
        nodes.push({
            id: packageNodeId(one.name),
            kind: 'package',
            name: one.name,
            package: outline.name,
            color: one.available ? PACKAGE_COLOR : UNRESOLVED_COLOR,
            isExternal: false,
            attributes: [],
            ...(one.location ? { location: one.location } : {}),
            ...(one.available ? {} : { unavailable: true }),
            ...(one.documentation ? { documentation: one.documentation } : {}),
            ...(one.source ? { source: one.source } : {})
        });
    }

    // An imported ontology is one card however many statements import it,
    // under whatever aliases: it is the ontology that is depended on, and an
    // alias is the importer's name for it. Two different ontologies that
    // declare one name are still two cards, in the order they are met.
    const imported = new Map<string, string>();
    const taken = new Set<string>();
    const importedNode = (one: OutlineImport): string => {
        const identity = one.ontology?.id ?? `<${one.location}>`;
        const known = imported.get(identity);
        if (known) {
            return known;
        }
        const name = one.ontology?.name ?? one.alias;
        let id = importNodeId(name);
        for (let count = 2; taken.has(id); count += 1) {
            id = `${importNodeId(name)}#${count}`;
        }
        taken.add(id);
        imported.set(identity, id);
        const opens = one.header ?? one.statement;
        nodes.push({
            id,
            kind: 'package',
            name,
            stereotype: 'ontology',
            color: one.ontology ? PACKAGE_COLOR : UNRESOLVED_COLOR,
            isExternal: true,
            attributes: [],
            location: one.location,
            ...(one.ontology ? {} : { unavailable: true }),
            ...(one.documentation ? { documentation: one.documentation } : {}),
            ...(opens ? { source: opens } : {})
        });
        return id;
    };
    const importFrom = (client: string, one: OutlineImport) => {
        const supplier = importedNode(one);
        const name = one.ontology?.name ?? one.alias;
        addEdge({
            kind: 'dependency',
            id: dependencyId('import', client, supplier),
            source: client,
            target: supplier,
            stereotype: 'import',
            ...(one.alias !== name ? { name: one.alias } : {}),
            ...(one.statement ? { source_: one.statement } : {})
        });
    };

    for (const one of outline.imports) {
        importFrom(frame, one);
    }
    const members = new Set(outline.packages.map(one => one.name));
    for (const one of outline.packages) {
        const client = packageNodeId(one.name);
        for (const used of one.uses) {
            // A `use` of a package outside the ontology, or of its own, is a
            // mistake the validator reports; drawn, it would be an arrow to a
            // package the ontology does not have, or a loop that means nothing.
            if (!members.has(used.name) || used.name === one.name) {
                continue;
            }
            const supplier = packageNodeId(used.name);
            addEdge({
                kind: 'dependency',
                id: dependencyId('use', client, supplier),
                source: client,
                target: supplier,
                stereotype: 'use',
                ...(used.statement ? { source_: used.statement } : {})
            });
        }
        for (const imported of one.imports) {
            importFrom(client, imported);
        }
    }

    const group: ViewGroup = {
        id: frame,
        name: outline.name,
        isExternal: false,
        nodes: outline.packages.map(one => packageNodeId(one.name)),
        kind: 'ontology'
    };
    return { kind: 'packages', groups: [group], nodes, edges, gensets: [] };
}

/** All ontologies in a workspace and their import dependencies, without package membership detail. */
export function deriveWorkspacePackages(ontologies: WorkspaceOntology[]): ViewModel {
    const ontologyId = (name: string) => `workspace-ontology:${name}`;
    const byIdentity = new Map(ontologies.map(one => [one.identity, one]));
    const byName = new Map(ontologies.map(one => [one.name, one]));
    const nodes: ViewNode[] = ontologies.map(one => ({
        id: ontologyId(one.name), kind: 'package', name: one.name, stereotype: 'ontology',
        color: PACKAGE_COLOR, isExternal: false, attributes: [], ...(one.source ? { source: one.source } : {})
    }));
    const edges: ViewEdge[] = [];
    const edgeIds = new Set<string>();
    const externalIds = new Map<string, string>();
    const taken = new Set(nodes.map(node => node.id));

    for (const client of ontologies) {
        for (const imported of client.imports) {
            const target = (imported.ontology && byIdentity.get(imported.ontology.id))
                ?? (imported.ontology && byName.get(imported.ontology.name));
            let supplier: string;
            if (target) {
                supplier = ontologyId(target.name);
            } else {
                const identity = imported.ontology?.id ?? `<${imported.location}>`;
                supplier = externalIds.get(identity) ?? importNodeId(imported.ontology?.name ?? imported.alias);
                if (!externalIds.has(identity)) {
                    const base = supplier;
                    for (let suffix = 2; taken.has(supplier); suffix += 1) {
                        supplier = `${base}#${suffix}`;
                    }
                    taken.add(supplier);
                }
                externalIds.set(identity, supplier);
                if (!nodes.some(node => node.id === supplier)) {
                    nodes.push({
                        id: supplier, kind: 'package', name: imported.ontology?.name ?? imported.alias,
                        stereotype: 'ontology', color: imported.ontology ? PACKAGE_COLOR : UNRESOLVED_COLOR,
                        isExternal: true, attributes: [], location: imported.location,
                        ...(!imported.ontology ? { unavailable: true } : {}),
                        ...(imported.documentation ? { documentation: imported.documentation } : {}),
                        ...(imported.header ?? imported.statement ? { source: imported.header ?? imported.statement } : {})
                    });
                }
            }
            const source = ontologyId(client.name);
            const id = dependencyId('import', source, supplier);
            if (source !== supplier && !edgeIds.has(id)) {
                edgeIds.add(id);
                edges.push({
                    kind: 'dependency', id, source, target: supplier, stereotype: 'import',
                    ...(imported.alias !== (target?.name ?? imported.ontology?.name ?? imported.alias)
                        ? { name: imported.alias } : {}),
                    ...(imported.statement ? { source_: imported.statement } : {})
                });
            }
        }
    }
    return { kind: 'packages', groups: [], nodes, edges, gensets: [] };
}

/**
 * The cards an edge end stands for: the card itself, or every package inside
 * the ontology frame an import leaves from. Moving any of those moves the end.
 */
export function endMembers(view: Pick<ViewModel, 'groups'>, end: string): string[] {
    const group = view.groups.find(one => one.id === end && one.kind === 'ontology');
    return group ? group.nodes : [end];
}

/** Whether an edge has an end on one of these cards, directly or through its frame. */
export function edgeTouches(
    view: Pick<ViewModel, 'groups'>, edge: Pick<ViewEdge, 'source' | 'target'>, ids: ReadonlySet<string>
): boolean {
    return [edge.source, edge.target].some(end => endMembers(view, end).some(id => ids.has(id)));
}
