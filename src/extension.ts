
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as helpers from './helpers';


export function activate(context: vscode.ExtensionContext) {
	// Proof of extension activation
	console.log('Stardew Valley Deploy and Pack is active');


	// Copies the core files from the templates folder into the user workspace
	const SDVGenerateCoreFiles = vscode.commands.registerCommand('sdvdeployandpack.SDVGenerateCoreFiles', async () => {
		if (!vscode.workspace.workspaceFolders) { return vscode.window.showErrorMessage('No workspace folder open'); }

		const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
		const extensionPath = vscode.extensions.getExtension('atlasv.sdvdeployandpack')!.extensionPath;

		// List of dicts of the files to copy over
		const filesToCopy = [
			{ src: "ConfigOverride.sdvextension", dest: vscode.Uri.joinPath(workspaceUri, 'ConfigOverride.sdvextension') },
			{ src: "IgnoreFiles.sdvextension", dest: vscode.Uri.joinPath(workspaceUri, 'IgnoreFiles.sdvextension') },
		];

		try {
			// Loops through all entries and actually copies the files
			for (const { src, dest } of filesToCopy) {
				const filePath = path.join(extensionPath, 'templates', src);
				const fileData = fs.readFileSync(filePath);

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
		if (!vscode.workspace.workspaceFolders) { return vscode.window.showErrorMessage('No workspace folder open'); }
		await vscode.commands.executeCommand(`sdvdeployandpack.SDVPack`);
		await vscode.commands.executeCommand(`sdvdeployandpack.SDVDeploy`);
	});

	const SDVPack = vscode.commands.registerCommand('sdvdeployandpack.SDVPack', async () => {
		if (!vscode.workspace.workspaceFolders) { return vscode.window.showErrorMessage('No workspace folder open'); }
		const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
		const filteredItems = await helpers.getWorkspaceItemsFiltered(workspaceUri);
		const { zipPath, modVersion } = await helpers.getPathsFromConfig();
		await helpers.createZip(filteredItems, workspaceUri, zipPath, modVersion);
		vscode.window.showInformationMessage(`Packing process completed`);
	});


	const SDVDeploy = vscode.commands.registerCommand('sdvdeployandpack.SDVDeploy', async () => {
		if (!vscode.workspace.workspaceFolders) { return vscode.window.showErrorMessage('No workspace folder open'); }
		vscode.window.showInformationMessage('Began deploy process');

		const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
		const { modFolderPath, smapiPath, rawModFolderPath } = await helpers.getPathsFromConfig();
		const filteredItems = await helpers.getWorkspaceItemsFiltered(workspaceUri);
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


	const SDVGenerateTemplates = vscode.commands.registerCommand('sdvdeployandpack.SDVGenerateTemplates', async () => {
		await helpers.quickPickRun(
			[
				{ label: "Alternative Textures", action: () => helpers.copyTemplateFiles("AlternativeTextures") },
				{ label: "Content Patcher", action: () => helpers.copyTemplateFiles("ContentPatcher") },
				{ label: "Custom Companions", action: () => helpers.copyTemplateFiles("CustomCompanions") },
				{ label: "Fashion Sense", action: () => helpers.copyTemplateFiles("FashionSense") },
			],
			"Choose which content pack files to generate"
		);
	});


	context.subscriptions.push(
		SDVGenerateCoreFiles,
		SDVDeployAndPack,
		SDVPack,
		SDVDeploy,
		SDVOpenSettings,
		SDVGenerateTemplates
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
