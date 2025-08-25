
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import archiver from 'archiver';


export function activate(context: vscode.ExtensionContext) {
	// Proof of extension activation
	console.log('Stardew Valley Deploy and Pack is active');

	// Function Tool

	function stripLeadingSlash(s: string) {
		return s.replace(/^\/+/, '');
	}

	// Removes inline and multiline comments, and trailing commas
	function sanitizeJson(content: string): string {
		return content
			.replace(/\/\/.*$/gm, '')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/,\s*([\]}])/g, '$1');
	}

	// Converts the file at the specified URI into a string in utf8 format
	async function readFileAsString(uri: vscode.Uri): Promise<string | null> {
		try {
			const data = await vscode.workspace.fs.readFile(uri);
			return Buffer.from(data).toString("utf8");
		} catch {
			return null;
		}
	}

	// ConfigOverride.sdvextension Parser
	async function getPathsFromConfig(): Promise<{
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
    async function getWorkspaceItemsFiltered(workspaceUri: vscode.Uri): Promise<string[]> {
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
		function toRegex(pattern: string, isDir: boolean): RegExp {
			// escape regex specials, but NOT * (* handled after)
			const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

			// Replace wildcard * with .*
			const wildcarded = escaped.replace(/\*/g, ".*");

			// Directory vs file suffix
			const regexStr = "^" + wildcarded + (isDir ? "(/.*)?$" : "$");
			return new RegExp(regexStr, "i");
		}


		
	async function createZip(filteredItems: string[], workspaceUri: vscode.Uri, zipPath: string, modVersion: string) {
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

	// Copies the core files from the templates folder into the user workspace
	const SDVGenerateCoreFiles = vscode.commands.registerCommand('sdvdeployandpack.SDVGenerateCoreFiles', async () => {
		if (!vscode.workspace.workspaceFolders) return vscode.window.showErrorMessage('No workspace folder open');

		const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
		const extensionPath = vscode.extensions.getExtension('atlasv.sdvdeployandpack')!.extensionPath;
		
		// List of dicts of the files to copy over
		const filesToCopy = [
			{ src: "ConfigOverride.sdvextension", dest: vscode.Uri.joinPath(workspaceUri, 'ConfigOverride.sdvextension') },
			{ src: "IgnoreFiles.sdvextension", dest: vscode.Uri.joinPath(workspaceUri, 'IgnoreFiles.sdvextension') },
			//TESTING { src: "manifest.json", dest: vscode.Uri.joinPath(workspaceUri, 'manifest.json'), skipIfExists: true }
		];

		try {
			// Loops through all entries and actually copies the files
			for (const { src, dest/*TESTING, skipIfExists*/ } of filesToCopy) {
				const filePath = path.join(extensionPath, 'templates', src);
				const fileData = fs.readFileSync(filePath);
				
				/*TESTING
				if (skipIfExists) {
					try { await vscode.workspace.fs.stat(dest); vscode.window.showInformationMessage(`${src} already exists, skipping.`); continue; }
					catch {}
				}
				*/
				await vscode.workspace.fs.writeFile(dest, fileData);
			}
			// Open the config file as the active window for initial configuration
			const ConfigFile = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspaceUri, 'ConfigOverride.sdvextension'));
            	await vscode.window.showTextDocument(ConfigFile);
				vscode.window.showInformationMessage(`Copied core files to workspace.`);
			} catch (err) {
            	vscode.window.showErrorMessage(`Failed to copy core file(s): ${err}`);
        	}
		});

	const SDVDeployAndPack = vscode.commands.registerCommand('sdvdeployandpack.SDVDeployAndPack', async () => {
		if (!vscode.workspace.workspaceFolders) return vscode.window.showErrorMessage('No workspace folder open');
		await vscode.commands.executeCommand(`sdvdeployandpack.SDVPack`);
		await vscode.commands.executeCommand(`sdvdeployandpack.SDVDeploy`);
	});

	const SDVPack = vscode.commands.registerCommand('sdvdeployandpack.SDVPack', async () => {
		if (!vscode.workspace.workspaceFolders) return vscode.window.showErrorMessage('No workspace folder open');
		const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
		const filteredItems = await getWorkspaceItemsFiltered(workspaceUri);
		const { zipPath, modVersion } = await getPathsFromConfig();
		await createZip(filteredItems, workspaceUri, zipPath, modVersion);
		vscode.window.showInformationMessage(`Packing process completed`);
	});
	

	const SDVDeploy = vscode.commands.registerCommand('sdvdeployandpack.SDVDeploy',async () => {
		if (!vscode.workspace.workspaceFolders) return vscode.window.showErrorMessage('No workspace folder open');
		vscode.window.showInformationMessage('Began deploy process');

		const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
		const { modFolderPath, smapiPath, rawModFolderPath } = await getPathsFromConfig();
		const filteredItems = await getWorkspaceItemsFiltered(workspaceUri);
		const workspaceName = path.basename(workspaceUri.fsPath);
		const targetFolderUri = vscode.Uri.joinPath(vscode.Uri.file(modFolderPath), workspaceName);

		// Deploys files to the mod folder
		try {
			await vscode.workspace.fs.createDirectory(targetFolderUri);

			for (const item of filteredItems) {
				const sourceUri = vscode.Uri.joinPath(workspaceUri, item);
				const destUri = vscode.Uri.joinPath(targetFolderUri, item);

				if ((await vscode.workspace.fs.stat(sourceUri)).type === vscode.FileType.Directory) {
					await vscode.workspace.fs.createDirectory(destUri);
				} else {
					await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(destUri.fsPath)));
					await vscode.workspace.fs.copy(sourceUri, destUri, { overwrite: true });
				}
			}

			vscode.window.showInformationMessage(
				`Deployed ${filteredItems.length} items to ${targetFolderUri.fsPath}`
			);
		} catch (err: any) {
			vscode.window.showErrorMessage(
				`Failed to deploy files: ${err?.message ?? err}`
			);
			return;
		}

		// Launches SMAPI in the vscode terminal (couldn't figure out how to open platform specific terminal)
		try {
			const stardewPath = vscode.workspace.getConfiguration().get<string>("sdvdeployandpack.StardewValleyPath") || "";

			const defaultSmapi = process.platform === "win32"
				? "StardewModdingAPI.exe"
				: "StardewModdingAPI";

			let executable: string;
			let args = "";

			// Check if SMAPIPath was explicitly set in ConfigOverride
			if (smapiPath && path.basename(smapiPath) !== defaultSmapi) {
				// Use the override as-is, no arguments
				executable = smapiPath.trim();
			} else {
				// Use the default SMAPI and add --mods-path
				executable = smapiPath.trim() || path.join(stardewPath, defaultSmapi);
				args = ` --mods-path "${rawModFolderPath}"`;
			}

			// If executable is not absolute, assume it's inside the Stardew folder
			if (!path.isAbsolute(executable)) {
				executable = path.join(stardewPath, executable);
			}

			// Clean up accidental leading slash
			if (executable.startsWith("/")) {
				executable = executable.slice(1);
			}

			const isWindows = process.platform === "win32";
			const cmd = isWindows
				? `& "${executable}"${args}`   // PowerShell
				: `"${executable}"${args}`;    // bash/sh

			const terminal = vscode.window.createTerminal({
				name: "SMAPI",
				cwd: path.dirname(executable)
			});

			terminal.show();
			terminal.sendText(cmd);

			vscode.window.showInformationMessage("SMAPI launched in terminal.");
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to launch SMAPI: ${err?.message ?? err}`);
		}
	});
	

	const SDVOpenSettings = vscode.commands.registerCommand('sdvdeployandpack.SDVOpenSettings', () => {
		vscode.commands.executeCommand(
      		"workbench.action.openSettings",
      		"@ext:atlasv.sdvdeployandpack"
    	);
		vscode.window.showInformationMessage('SDV Deploy and Pack setting opened');
	});


	context.subscriptions.push(
		SDVGenerateCoreFiles,
		SDVDeployAndPack,
		SDVPack,
		SDVDeploy,
		SDVOpenSettings
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
