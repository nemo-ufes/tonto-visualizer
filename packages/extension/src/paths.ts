import { sep } from 'node:path';

/**
 * Whether a file lies in a folder, both as file-system paths.
 *
 * With the platform's own separator: a check written with `/` held on macOS
 * and Linux and never on Windows, where the workspace diagram then ignored
 * every keystroke, every unsaved buffer and every parse error.
 */
export function isWithinFolder(path: string, folder: string, separator: string = sep): boolean {
    if (path === folder) {
        return true;
    }
    const prefix = folder.endsWith(separator) ? folder : `${folder}${separator}`;
    return path.startsWith(prefix);
}
