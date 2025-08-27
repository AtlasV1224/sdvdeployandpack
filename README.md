[![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FAtlasV1224%2Fsdvdeployandpack%2Frefs%2Fheads%2Fmaster%2Fpackage.json&query=%24.version&label=Version&labelColor=%23333&color=%23555)](https://github.com/AtlasV1224/sdvdeployandpack/blob/master/CHANGELOG.md)
[![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FAtlasV1224%2Fsdvdeployandpack%2Frefs%2Fheads%2Fmaster%2Fpackage.json&query=%24.license&label=License&labelColor=%23333&color=%23555)](https://github.com/AtlasV1224/sdvdeployandpack/blob/master/LICENSE.txt)




# Stardew Valley: Deploy and Pack

A VSCode extension to aid in packing and deploying none C# mods that works on Windows, Linux, and Mac.


## Features

### This extension:
- Packs the mod into a zip folder optionally suffixed by a version number, and placed into a specifiable folder.
- Deploys the mod into a specifiable mod folder, seperate from the working folder, and loads the game with the mod installed.
- Does both at the same time.
- Supports Windows, Linux, and Mac systems
- Can generate base files for:
    - Content Patcher
    - Alternative Textures
    - Custom Companions
    - Fashion Sense

More features are planned and in the works like generating the base files for various frameworks and automatic updating of the version in manifest.json files.


## Basic Usage

- Using the Command Palette: Run `Stardew Valley: Settings`, and add the installation folder for Stardew Valley.
- Open or create a workspace for your mod (the workspace should be named the same as the name you want to appear in the mods folder).
- Using the Command Palette: Run `Stardew Valley: Generate core files`, and fill the relevant fields.
- Create your mod!
- Using the Command Palette: 
    - Run `Stardew Valley: Pack`, to pack your mod into a zip folder.
    - Run `Stardew Valley: Deploy`, to deploy your mod and launch Stardew Valley.
    - Run `Stardew Valley: Deploy and Pack`, to both deploy your mod and launch Stardew Valley, and pack your mod into a zip folder.


## Advanced Usage

Packing and deploying supports ignore files, the files to be ignored are defined in the `IgnoreFiles.sdvextension` file with JSON array formating, these support wildcards in the form of an asterisk (`*`), and directories in the form of a forward-slash (`/`) suffixed to the directory name.


## Extension Settings

This extension contributes the following settings:

* `sdvdeployandpack.StardewValleyPath`: The file path for the Stardew Valley installation.


## Known Issues

None yet


## Release Notes

### 0.1.0-preview

Initial preview release, expect bugs, weirdness, and general confusion.





