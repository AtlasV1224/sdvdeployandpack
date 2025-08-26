import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import archiver from 'archiver';

export function stripLeadingSlash(s: string) {
    return s.replace(/^\/+/, '');
}

// Removes inline and multiline comments, and trailing commas
export function sanitizeJson(content: string): string {
    return content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([\]}])/g, '$1');
}

// Converts the file at the specified URI into a string in utf8 format
export async function readFileAsString(uri: vscode.Uri): Promise<string | null> {
    try {
        const data = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(data).toString("utf8");
    } catch {
        return null;
    }
}

// ConfigOverride.sdvextension Parser
export async function getPathsFromConfig(): Promise<{
    zipPath: string;
    modFolderPath: string;
    smapiPath: string;
    modVersion: string;
    rawModFolderPath: string;
}> {
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder open");
        return {
            zipPath: "",
            modFolderPath: "",
            smapiPath: "",
            modVersion: "",
            rawModFolderPath: ""
        };
    }

    const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
    const configUri = vscode.Uri.joinPath(workspaceUri, 'ConfigOverride.sdvextension');

    let configContent = await readFileAsString(configUri) ?? "{}";
    configContent = sanitizeJson(configContent);

    // Parse sanitized ConfigOverride as json format
    let configObj: Record<string, string> = {};
    try {
        configObj = JSON.parse(configContent);
    } catch (err) {
        vscode.window.showErrorMessage("ConfigOverride.sdvextension has invalid JSON. Using defaults.");
    }


    const stardewPath = vscode.workspace.getConfiguration().get<string>("sdvdeployandpack.StardewValleyPath") || "";

    // Default values, supported for specific platforms
    const defaultZipPath = "ZippedMods";
    const defaultModFolderPath = "Mods";
    const defaultSmapiPath = process.platform === "win32"
        ? "StardewModdingAPI.exe" // Windows (obvs)
        : "StardewModdingAPI"; // Mac, Linux

    // Retrieves default values if values not present in ConfigOverride
    const zipPath = path.join(stardewPath, configObj.ZipPath?.trim() || defaultZipPath);
    const modFolderPath = path.join(stardewPath, configObj.ModFolderPath?.trim() || defaultModFolderPath);
    const smapiPath = path.join(stardewPath, configObj.SMAPIPath?.trim() || defaultSmapiPath);
    const modVersion = configObj.ModVersion?.trim() || "";
    const rawModFolderPath = stripLeadingSlash(configObj.ModFolderPath?.trim() || defaultModFolderPath);

    return { zipPath, modFolderPath, smapiPath, modVersion, rawModFolderPath };
}


// Returns files to ignore when packing and deploying from IgnoreFiles.sdvextension and adds to an array
export async function getWorkspaceItemsFiltered(workspaceUri: vscode.Uri): Promise<string[]> {
    const collected: string[] = [];

    // Read IgnoreFiles
    let ignoreList: string[] = [];
    const ignoreFileUri = vscode.Uri.joinPath(workspaceUri, 'IgnoreFiles.sdvextension');
    let fileContent = await readFileAsString(ignoreFileUri);
    if (fileContent) {
        fileContent = sanitizeJson(fileContent);
        ignoreList = JSON.parse(fileContent);
    }

    // Does recursive magic, I really don't know how this works, this will probably be the thing that breaks first
    async function readDirRecursive(uri: vscode.Uri, relativePath = '') {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        for (const [name, type] of entries) {
            const entryPath = relativePath ? `${relativePath}/${name}` : name;

            // Add directories themselves before recursion
            if (type === vscode.FileType.Directory) {
                collected.push(entryPath + '/'); // adds trailing slash to define directory
                await readDirRecursive(vscode.Uri.joinPath(uri, name), entryPath);
            } else if (type === vscode.FileType.File) {
                collected.push(entryPath);
            }
        }
    }

    await readDirRecursive(workspaceUri);

    // Excludes files in the IgnoreFiles.sdvextension
    const filtered = collected.filter(itemPath =>
        !ignoreList.some(pattern => {
            const isDir = pattern.endsWith("/");
            const clean = (isDir ? pattern.slice(0, -1) : pattern).trim();
            if (!clean) return false;
            return toRegex(clean, isDir).test(itemPath);
        })
    );

    return filtered;
}

// I cried; how does regex work (thx Ryan, couldn't do this without you)
export function toRegex(pattern: string, isDir: boolean): RegExp {
    // escape regex specials, but NOT * (* handled after)
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

    // Replace wildcard * with .*
    const wildcarded = escaped.replace(/\*/g, ".*");

    // Directory vs file suffix
    const regexStr = "^" + wildcarded + (isDir ? "(/.*)?$" : "$");
    return new RegExp(regexStr, "i");
}



export async function createZip(filteredItems: string[], workspaceUri: vscode.Uri, zipPath: string, modVersion: string) {
    // Name the zip after the workspace name + modVersion (if present)
    const workspaceName = path.basename(workspaceUri.fsPath);
    const zipFileName = `${workspaceName}${modVersion ? `_${modVersion}` : ''}.zip`;
    const zipFileFullPath = path.join(zipPath, zipFileName);

    // Make zipPath directory if it doesn't exist
    if (!fs.existsSync(zipPath)) {
        fs.mkdirSync(zipPath, { recursive: true });
    }

    // Creates zip file to stream data to
    const output = fs.createWriteStream(zipFileFullPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Listens for all data to be written to archive
    output.on('close', () => {
        vscode.window.showInformationMessage(`ZIP created: ${zipFileFullPath} (${archive.pointer()} total bytes)`);
    });

    // Tosses error incase shit hits fan
    archive.on('error', (err) => {
        vscode.window.showErrorMessage(`Error creating ZIP: ${err.message}`);
    });

    // Pipe, works like a pipe, makes data go from archive to output (baso self explanitory)
    archive.pipe(output);

    // Adds files to the archive
    for (const file of filteredItems) {
        const fullFilePath = path.join(workspaceUri.fsPath, file);
        archive.file(fullFilePath, { name: file });
    }

    await archive.finalize();
}
