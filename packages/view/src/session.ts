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

import type { LangiumDocument } from 'langium';
import { DocumentState, URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createTontoServices, isModel } from 'tonto-language';
import type { Model } from './language.js';

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
        return documents
            // The built-in datatypes are a virtual document the workspace loads
            // so that `name: string` resolves. They are the standard library,
            // not part of anyone's model, and drawing six boxes for them is not
            // what "show datatypes" means.
            .filter(document => document.uri.scheme === 'file')
            .map(document => document.parseResult.value)
            .filter((value): value is Model => isModel(value));
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
