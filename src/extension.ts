// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import fs, {existsSync} from "node:fs";
import path from "node:path";
import {IBMiMember, ObjectItem} from "@halcyontech/vscode-ibmi-types";
import {loadBase, getBase} from './base';

// this method is called when your extension is activated

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  
  loadBase(context);
  
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('ibmi-srcpfextension.DownloadSrcPf', async (node: ObjectItem, nodes?: (ObjectItem)[]) => {
      const contentApi = getContent();
      const connection = getConnection();
      const config = getConfig();
      let subFolder = '';
      let locationChoosen = false;
      let downloadLocationURI: vscode.Uri | undefined;

      //Gather all the members
      let members: IBMiMember[] = [];
      for (const item of (nodes || [node])) {
        subFolder = item.object.name;
        if ("object" in item) {
          members = [];
          members.push(...await contentApi.getMemberList({ library: item.object.library, sourceFile: item.object.name }));

          if (!locationChoosen) {
            locationChoosen = true;
              downloadLocationURI = (await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFiles: false,
                canSelectFolders: true
              }))?.[0];
          }

          if (downloadLocationURI) {
            //Remove double entries and map to { path, copy } object
            const toBeDownloaded = members
              .filter((member, index, list) => list.findIndex(m => m.library === member.library && m.file === member.file && m.name === member.name) === index)
              .sort((m1, m2) => m1.name.localeCompare(m2.name))
              .map(member => ({ member, path: qualifyPath(member.library, member.file, member.name, member.asp), name: `${member.name}.${member.extension || "MBR"}`, copy: true }));
            for (const item of toBeDownloaded) {
              if (item.member.text != null) {
                item.member.text = item.member.text.replaceAll('.', '')
                                                   .replaceAll('-', '_')
                                                   .replaceAll(',', '_')
                                                   .replaceAll(';', '_')
                                                   .replaceAll('&', '')
                                                   .replaceAll('+', '')
                                                   .replaceAll('?', '')
                                                   .replaceAll('!', '')
                                                   .replaceAll('^', ' ')
                                                   .replaceAll('/', '_')
                                                   .replaceAll('\\', '_')
                                                   .replaceAll(`'`,'')
                                                   .replaceAll(`"`,'')
                                                   .replaceAll(':', '')
                                                   .replaceAll('<', '')
                                                   .replaceAll('>', '')
                                                   .replaceAll('*', '')
                                                   .replaceAll('  ', ' ');
              }
              if (item.member.extension === null || item.member.extension === undefined || item.member.extension === '') {
                item.member.extension = 'TXT';
              }
            }
            let downloadLocation = downloadLocationURI.path;
            downloadLocation = downloadLocation + '/' + subFolder;

            vscode.window.showInformationMessage(vscode.l10n.t(`Downloading to {0}`, downloadLocation));

            createDirectory(downloadLocation);

            //await connection.setLastDownloadLocation(downloadLocation);

            //Ask what do to with existing files in the target directory
            let overwriteAll = false;
            let skipAll = false;
            const overwriteLabel = vscode.l10n.t(`Overwrite`);
            const overwriteAllLabel = vscode.l10n.t(`Overwrite all`);
            const skipAllLabel = vscode.l10n.t(`Skip all`);
            for (const item of toBeDownloaded) {
              const target = path.join(fixWindowsPath(downloadLocation), item.name);
              if (existsSync(target)) {
                if (skipAll) {
                  item.copy = false;
                }
                else if (!overwriteAll) {
                  const answer = await vscode.window.showWarningMessage(vscode.l10n.t(`{0} already exists.
Do you want to replace it?`, item.name), { modal: true }, skipAllLabel, overwriteLabel, overwriteAllLabel);
                  if (answer) {
                    overwriteAll ||= (answer === overwriteAllLabel);
                    skipAll ||= (answer === skipAllLabel);
                    item.copy = !skipAll && (overwriteAll || answer === overwriteLabel);
                  }
                  else {
                    //Abort!
                    vscode.window.showInformationMessage(vscode.l10n.t(`Members download cancelled.`));
                    return;
                  }
                }
              }
            }

            // Download members
            await connection.withTempDirectory(async directory => {
              for (const item of toBeDownloaded) {
                if (item.copy) {
                  vscode.window.showInformationMessage(vscode.l10n.t(`Downloading {0}...`, item.name));
                  let command = `CPYTOSTMF FROMMBR('${qualifyPath(item.member.library, item.member.file, item.member.name)}') TOSTMF('${directory}/${item.member.name.toLocaleLowerCase()}-${item.member.text}.${item.member.extension}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${config.sourceFileCCSID})`;
                  await connection.runCommand({
                    command: command
                  });
                }
              } 
              await connection.getContent().downloadDirectory(downloadLocation, directory);
              vscode.window.showInformationMessage(vscode.l10n.t(`Members download complete for {0}.`, downloadLocation), vscode.l10n.t(`Open`))
                .then(open => open ? vscode.commands.executeCommand('revealFileInOS', downloadLocationURI) : undefined);
            });
          }
        }
      }
    });

	context.subscriptions.push(disposable);
}

function getConnection() {
  const connection = getBase()!.instance.getConnection();
  if (connection) {
    return connection;
  }
  else {
    throw new Error(vscode.l10n.t(`Not connected to an IBM i`));
  }
}

function getContent() {
  const content = getBase()!.instance.getConnection()?.getContent();
  if (content) {
    return content;
  }
  else {
    throw new Error(vscode.l10n.t(`Not connected to an IBM i`));
  }
}

function getConfig() {
  const config = getBase()!.instance.getConnection()?.getConfig();
  if (config) {
    return config;
  }
  else {
    throw new Error(vscode.l10n.t(`Not connected to an IBM i`));
  }
}

function createDirectory(dirPath: string): void {
    try {
        // Resolve to absolute path
        let fullPath = path.resolve(dirPath).replace('C:\\C:', 'C:');

        // Check if directory exists
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true }); // recursive ensures nested dirs are created
            console.log(`✅ Directory created: ${fullPath}`);
        } else {
            console.log(`ℹ️ Directory already exists: ${fullPath}`);
        }
    } catch (error) {
        console.error(`❌ Failed to create directory: ${(error as Error).message}`);
    }
}

  function qualifyPath(library: string, object: string, member?: string, iasp?: string, noEscape?: boolean) {
    [library, object] = sanitizeObjNamesForPase([library, object]);
    member = member ? sanitizeObjNamesForPase([member])[0] : undefined;
    iasp = iasp ? sanitizeObjNamesForPase([iasp])[0] : undefined;

    const libraryPath = library === `QSYS` ? `QSYS.LIB` : `QSYS.LIB/${library}.LIB`;
    const filePath = object ? `${object}.FILE` : '';
    const memberPath = member ? `/${member}.MBR` : '';
    const fullPath = `${libraryPath}/${filePath}${memberPath}`;

    const result = (iasp && iasp.length > 0 ? `/${iasp}` : ``) + `/${noEscape ? fullPath : escapePath(fullPath)}`;
    return result;
  }

  /**
   * Unqualify member path from root
   */
   function unqualifyPath(memberPath: string) {
    const pathInfo = path.posix.parse(memberPath);
    let splitPath = pathInfo.dir.split(path.posix.sep);

    // Remove use of `QSYS.LIB` two libraries in the path aren't value
    const isInQsys = splitPath.filter(part => part.endsWith(`.LIB`)).length === 2;
    if (isInQsys) {
      splitPath = splitPath.filter(part => part !== `QSYS.LIB`);
    }

    const correctedDir = splitPath.map(part => {
      const partInfo = path.posix.parse(part);
      if ([`.FILE`, `.LIB`].includes(partInfo.ext)) {
        return partInfo.name;
      } else {
        return part;
      }
    })
      .join(path.posix.sep);

    return path.posix.join(correctedDir, pathInfo.base);
  }

  /**
   * @param Path
   * @returns the escaped path
   */
  function escapePath(Path: string, alreadyQuoted = false): string {
    if (alreadyQuoted) {
      return Path.replace(/"|\$|\\/g, matched => `\\`.concat(matched));
    } else {
      return Path.replace(/'|"|\$|&|\\| /g, matched => `\\`.concat(matched));
    }
  }

  function sanitizeObjNamesForPase(libraries: string[]): string[] {
    return libraries
      .map(library => {
        // Quote libraries starting with #
        return library.startsWith(`#`) ? `"${library}"` : library;
      });
  }

  function fixWindowsPath(path: string) {
    if (process.platform === `win32` && path.startsWith(`/`)) {
      //Issue with getFile not working propertly on Windows
      //when there was a / at the start.
      return path.substring(1);
    } else {
      return path;
    }
  }

// This method is called when your extension is deactivated
export function deactivate() {}
