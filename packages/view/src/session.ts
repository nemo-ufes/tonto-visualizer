/**
 * A Tonto workspace, kept open, so a diagram can be asked for on every
 * keystroke.
 *
 * The language reads a model as every `.tonto` file under its root, because
 * half of what a diagram draws -- a relation declared in another file, a
 * supertype imported by name -- is not in the file being edited. So the session
 * loads the root once and afterwards replaces one document at a time: the
 * buffer as it currently reads in the editor, saved or not.
 *
 * Node only. The canvas gets a `ViewModel`, never this.
 */

import { resolve, sep } from 'node:path';
import type { AstNode, LangiumDocument } from 'langium';
import { AstUtils, DocumentState, URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import type { Import, Package } from 'tonto-language';
import { createTontoServices, isClassDeclaration, isModel, isOntologyBody } from 'tonto-language';
import type { Model } from './language.js';
import type { SourceLocation } from './model.js';
import type { OntologyOutline, OutlineImport, OutlinePackage, WorkspaceOntology } from './outline.js';

// Ownership is the language's: which package a bundle entry selected, and
// which ontology an import loaded, as its publication workspace decided them
// on the last build. The module reads the file system, which is why it is
// borrowed here and not in `language.ts` (see the note there).
// eslint-disable-next-line no-restricted-imports
import { bundleTargets, publicationWorkspace } from '../../../vendor/tonto/packages/language/out/publication/workspace.js';

/**
 * Where the model a file belongs to starts, by the language's own rule: the
 * nearest ancestor with a `tonto.json`, else the highest one still holding
 * models. A package bundled from `lending/lending.tonto` belongs to the
 * manifest a directory up, and a session over the file's folder alone never
 * loaded it.
 */
export { workspaceRootOf as modelRoot } from 'tonto-language';

export interface SessionOptions {
    /** Directories whose `.tonto` files are loaded, so imports resolve. */
    workspace?: string[];
}

export class ViewSession {
    private readonly services = createTontoServices(NodeFileSystem);
    private opened: Promise<void> | undefined;
    /** Buffers the editor holds that differ from what is on disk. */
    private readonly dirty = new Map<string, string>();

    constructor(private readonly options: SessionOptions = {}) {}

    /** Loads the workspace once; later calls wait for the same load. */
    private open(): Promise<void> {
        this.opened ??= this.services.shared.workspace.WorkspaceManager.initializeWorkspace(
            (this.options.workspace ?? []).map(folder => ({
                name: folder,
                uri: URI.file(folder).toString()
            }))
        );
        return this.opened;
    }

    /**
     * Replaces a document's text with what the editor currently shows.
     *
     * The document keeps its URI, so everything that resolved to it still does:
     * a class the modeller is halfway through renaming is a changed document,
     * not a new one.
     */
    async update(uri: string, text: string): Promise<void> {
        await this.open();
        this.dirty.set(uri, text);
        const parsed = URI.parse(uri);
        const documents = this.services.shared.workspace.LangiumDocuments;
        if (documents.hasDocument(parsed)) {
            documents.deleteDocument(parsed);
        }
        documents.addDocument(
            this.services.shared.workspace.LangiumDocumentFactory.fromString(text, parsed)
        );
    }

    /** Forgets an editor buffer, so the file on disk is read again. */
    async revert(uri: string): Promise<void> {
        await this.open();
        this.dirty.delete(uri);
        const parsed = URI.parse(uri);
        const documents = this.services.shared.workspace.LangiumDocuments;
        if (documents.hasDocument(parsed)) {
            documents.deleteDocument(parsed);
        }
        documents.addDocument(
            await this.services.shared.workspace.LangiumDocumentFactory.fromUri(parsed)
        );
    }

    /**
     * Every model in the workspace, linked.
     *
     * The whole set is rebuilt rather than the changed document alone: a
     * reference from another file to a class that has just been renamed is
     * stale until the document holding it is re-linked, and a diagram drawn
     * from stale links has edges to elements that are no longer there.
     */
    async models(): Promise<Model[]> {
        await this.open();
        // Replacing an editor buffer removes and re-adds its document. Sorting by
        // URI keeps package order, relation occurrence ids and saved routes from
        // changing merely because that file was the last one typed in.
        const documents = this.services.shared.workspace.LangiumDocuments.all.toArray()
            .sort((one, other) => one.uri.toString().localeCompare(other.uri.toString()));
        for (const document of documents) {
            this.services.shared.workspace.DocumentBuilder.resetToState(document, DocumentState.Parsed);
        }
        await this.services.shared.workspace.DocumentBuilder.build(documents, { validation: false });
        const roots = (this.options.workspace ?? []).map(folder => resolve(folder));
        // The build may have added documents: an ontology imported by location
        // is loaded during it, from wherever the import points.
        return this.services.shared.workspace.LangiumDocuments.all.toArray()
            .sort((one, other) => one.uri.toString().localeCompare(other.uri.toString()))
            // The built-in datatypes are a virtual document the workspace loads
            // so that `name: string` resolves. They are the standard library,
            // not part of anyone's model, and drawing six boxes for them is not
            // what "show datatypes" means.
            .filter(document => document.uri.scheme === 'file')
            // Nor is an ontology this one imports from outside the workspace.
            // Its classes are drawn where something here points at them, as
            // any external class is; it does not join the packages a
            // workspace-wide view is made of.
            .filter(document => roots.length === 0 || this.dirty.has(document.uri.toString())
                || roots.some(root => document.uri.fsPath === root || document.uri.fsPath.startsWith(root + sep)))
            .map(document => document.parseResult.value)
            .filter((value): value is Model => isModel(value));
    }

    /** Count declarations the language identifies as classes, before deriving a view. */
    classCount(models: readonly Model[]): number {
        return models.reduce((count, model) => count + model.packages.reduce(
            (packageCount, pkg) => packageCount + pkg.declarations.filter(isClassDeclaration).length,
            0
        ), 0);
    }

    /**
     * The ontology a manifest declares, as a package diagram reads it, or
     * `undefined` when the document is not a manifest.
     *
     * A manifest is an entry document with a `bundles` clause. An entry whose
     * packages are all written in it, or a monolithic one, holds the
     * declarations themselves, and its picture is still a class diagram.
     *
     * Read after `models()`, whose build is what decided ownership.
     */
    async outline(uri: string): Promise<OntologyOutline | undefined> {
        await this.open();
        const document = this.documentOf(uri);
        const model = document?.parseResult.value;
        if (!isModel(model)) {
            return undefined;
        }
        const header = model.ontologies[0];
        if (!header?.bundled) {
            return undefined;
        }
        const publication = publicationWorkspace(this.services.shared);
        const documentation = this.documentation();
        const documented = (node: AstNode) => {
            const text = documentation(node);
            return text ? { documentation: text } : {};
        };
        const located = (node: AstNode) => {
            const source = locationOf(node);
            return source ? { source } : {};
        };

        const importOf = (statement: Import): OutlineImport => {
            const unit = publication.imported.get(statement);
            const header = unit?.root?.parseResult.value.ontologies[0];
            const opens = header && unit?.root?.uri.scheme === 'file' ? locationOf(header) : undefined;
            const at = locationOf(statement);
            return {
                alias: statement.alias ?? '',
                location: (statement.location ?? '').slice(1, -1),
                ...(unit ? { ontology: { id: unit.id, name: unit.declaration?.name ?? unit.name } } : {}),
                ...(at ? { statement: at } : {}),
                ...(opens ? { header: opens } : {}),
                ...(header ? documented(header) : {})
            };
        };
        const ontologyImports = (statements: Import[]) =>
            statements.filter(statement => statement.location !== undefined).map(importOf);

        const members = new Set<Package>();
        const memberOf = (one: Package, location?: string): OutlinePackage => {
            members.add(one);
            const own = AstUtils.getDocument(one).parseResult.value as Model;
            // A document-level `use` or import applies to the packages of its
            // document; in the manifest, an import there applies to every
            // member and is the ontology's, so it is not repeated per package.
            const inManifest = own === model;
            const statements = [...(inManifest ? own.imports.filter(one => one.location === undefined) : own.imports), ...one.imports];
            return {
                name: one.name ?? '',
                ...(location ? { location } : {}),
                available: true,
                uses: statements
                    .filter(statement => statement.location === undefined && statement.package?.ref)
                    .map(statement => {
                        const at = locationOf(statement);
                        return { name: statement.package!.ref!.name ?? '', ...(at ? { statement: at } : {}) };
                    }),
                imports: ontologyImports(statements),
                ...located(one),
                ...documented(one)
            };
        };

        const packages: OutlinePackage[] = [];
        for (const one of model.packages) {
            if (!isOntologyBody(one) && one.name) {
                packages.push(memberOf(one));
            }
        }
        for (const bundle of header.bundles) {
            const location = bundle.location.slice(1, -1);
            const selected = bundleTargets.get(bundle);
            if (selected && !members.has(selected)) {
                packages.push(memberOf(selected, location));
            } else if (!selected) {
                const at = locationOf(bundle);
                packages.push({
                    name: bundle.name, location, available: false, uses: [], imports: [],
                    ...(at ? { source: at } : {})
                });
            }
        }
        return {
            name: header.name,
            packages,
            imports: ontologyImports(model.imports),
            ...located(header),
            ...documented(header)
        };
    }

    /** Every declared ontology in the workspace and its language-resolved imports. */
    async workspaceOntologies(models?: Model[]): Promise<WorkspaceOntology[]> {
        await this.open();
        const all = models ?? await this.models();
        const publication = publicationWorkspace(this.services.shared);
        const result: WorkspaceOntology[] = [];
        const names = new Set<string>();
        for (const model of all) {
            const header = model.ontologies[0];
            const identity = documentUri(model);
            if (!header?.name || !identity || names.has(header.name)) {
                continue;
            }
            names.add(header.name);
            const manifest = header.bundled ? await this.outline(identity) : undefined;
            const imports: OutlineImport[] = manifest
                ? [...manifest.imports, ...manifest.packages.flatMap(one => one.imports)]
                : model.imports.filter(statement => statement.location !== undefined).map(statement => {
                    const unit = publication.imported.get(statement);
                    const importedHeader = unit?.root?.parseResult.value.ontologies[0];
                    const source = locationOf(statement);
                    const targetSource = importedHeader && unit?.root?.uri.scheme === 'file'
                        ? locationOf(importedHeader) : undefined;
                    return {
                        alias: statement.alias ?? '',
                        location: (statement.location ?? '').slice(1, -1),
                        ...(unit ? { ontology: { id: unit.id, name: unit.declaration?.name ?? unit.name } } : {}),
                        ...(source ? { statement: source } : {}),
                        ...(targetSource ? { header: targetSource } : {})
                    };
                });
            const source = locationOf(header);
            result.push({ name: header.name, identity, imports, ...(source ? { source } : {}) });
        }
        return result;
    }

    /** The models of one document only, for a view that follows a single file. */
    async modelsOf(uri: string, models?: Model[]): Promise<Model[]> {
        const all = models ?? await this.models();
        const parsed = URI.parse(uri).toString();
        return all.filter(model => documentUri(model) === parsed);
    }

    /**
     * Parse errors in a document, which is what a stale picture is explained by.
     *
     * With the line, because the one place the reason is shown is a tooltip on
     * the panel, and "Expecting token of type ..." alone does not say where. A
     * keyword the pinned language does not know yet -- `derivedFrom`, added
     * upstream while the pin stayed behind -- parses in the editor and fails
     * here, and that is the case where knowing which line matters.
     */
    async parseErrors(uri: string): Promise<string[]> {
        await this.open();
        const document = this.documentOf(uri);
        return document?.parseResult.parserErrors.map(error => {
            const line = error.token.startLine;
            return line !== undefined && Number.isFinite(line) ? `line ${line}: ${error.message}` : error.message;
        }) ?? [];
    }

    /** `///` documentation, read the way the hover reads it. */
    documentation(): (node: object) => string | undefined {
        const provider = this.services.Tonto.documentation.DocumentationProvider;
        return node => provider.getDocumentation(node as never);
    }

    private documentOf(uri: string): LangiumDocument | undefined {
        const parsed = URI.parse(uri);
        const documents = this.services.shared.workspace.LangiumDocuments;
        return documents.hasDocument(parsed) ? documents.getDocument(parsed) : undefined;
    }
}

function documentUri(model: Model): string | undefined {
    return model.$document?.uri.toString();
}

function locationOf(node: AstNode): SourceLocation | undefined {
    const range = node.$cstNode?.range;
    if (!range) {
        return undefined;
    }
    return {
        uri: AstUtils.getDocument(node).uri.toString(),
        line: range.start.line,
        character: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character
    };
}
