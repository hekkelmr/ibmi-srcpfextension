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
	vscode.commands.registerCommand('ibmi-srcpfextension.DownloadSrcPf', async (node: ObjectItem, nodes?: (ObjectItem)[]) => {
    downloadMembersTobiImpl(`FILE`, node, nodes);
  });

async function downloadMembersTobiImpl(mode: `LIB` | `FILE`, node: ObjectItem, nodes?: (ObjectItem)[]) {
  const contentApi = getContent();

  // Gather all members to download
  const members: IBMiMember[] = [];
  for (const item of (nodes || [node])) {
    if (`object` in item) {
      members.push(...await contentApi.getMemberList({ library: item.object.library, sourceFile: item.object.name }));
    } 
  }

  if (members.length === 0) {
    vscode.window.showWarningMessage(vscode.l10n.t(`No members found to download.`));
    return;
  }

  // Prompt for root folder once
  const rootUriArray = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: vscode.l10n.t(`Select base download folder`),
    //defaultUri: vscode.Uri.file(IBMi.GlobalStorage.getLastDownloadLocation()),
    title: mode === `LIB`
      ? vscode.l10n.t(`Download {0} member(s) into Library/File/Member folders`, members.length)
      : vscode.l10n.t(`Download {0} member(s) into File/Member folders`, members.length)
  });

  if (!rootUriArray || rootUriArray.length === 0) return;
  const rootPath = rootUriArray[0].fsPath;
  //await IBMi.GlobalStorage.setLastDownloadLocation(rootPath);

  // Deduplicate
  const toDownload = members.filter(
    (m, i, arr) => arr.findIndex(x => x.library === m.library && x.file === m.file && x.name === m.name) === i
  );

  // For FILE mode: detect cross-library collisions and fall back to LIB layout for those members
  const fileKey = (m: IBMiMember) => `${m.file.toUpperCase()}/${m.name.toUpperCase()}.${(m.extension || `MBR`).toUpperCase()}`;
  let collidingKeys = new Set<string>();
  if (mode === `FILE`) {
    const keyCounts = new Map<string, number>();
    for (const m of toDownload) {
      const k = fileKey(m);
      keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
    }
    collidingKeys = new Set([...keyCounts.entries()].filter(([, count]) => count > 1).map(([k]) => k));
    if (collidingKeys.size > 0) {
      const examples = [...collidingKeys].slice(0, 3).join(`, `);
      vscode.window.showWarningMessage(
        vscode.l10n.t(`{0} path collision(s) detected (e.g. {1}). The library folder will be included for those members only.`, collidingKeys.size, examples)
      );
    }
  }

  await vscode.window.withProgress(
    { title: vscode.l10n.t(`Downloading {0} member(s)`, toDownload.length), location: vscode.ProgressLocation.Notification },
    async (progress) => {
      let done = 0;
      const errors: string[] = [];
      for (const member of toDownload) {
        const useLibrary = mode === `LIB` || collidingKeys.has(fileKey(member));
        const localDir = useLibrary
          ? path.join(rootPath, member.library.toUpperCase(), member.file.toUpperCase())
          : path.join(rootPath, member.file.toUpperCase());

        if (member.text != null) {
                member.text = member.text.replaceAll('.', '')
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

        const localFile = path.join(localDir, `${member.name.toLowerCase()}-${member.text || ''}.${(member.extension.toLowerCase() || `txt`)}`);

        progress.report({
          message: useLibrary
            ? `${member.library}/${member.file}/${member.name}.${member.extension || `MBR`}`
            : `${member.file}/${member.name}.${member.extension || `MBR`}`,
          increment: (100 / toDownload.length)
        });
        try {
          fs.mkdirSync(localDir, { recursive: true });
          const content = await contentApi.downloadMemberContent(member.library, member.file, member.name);
          if (content !== undefined) {
            fs.writeFileSync(localFile, content, `utf8`);
          }
        } catch (e: any) {
          errors.push(`${member.library}/${member.file}/${member.name}: ${String(e)}`);
        }
        done++;
      }

      if (errors.length > 0) {
        vscode.window.showWarningMessage(
          vscode.l10n.t(`{0} of {1} member(s) downloaded. {2} error(s).`, done - errors.length, toDownload.length, errors.length),
          vscode.l10n.t(`Show Details`)
        ).then(action => {
          if (action) {
            vscode.window.showErrorMessage(errors.join(`\n`));
          }
        });
      } else {
        vscode.window.showInformationMessage(
          vscode.l10n.t(`{0} member(s) downloaded to {1}`, done, rootPath),
          vscode.l10n.t(`Open download folder`)
        ).then(action => {
          if (action) {
            vscode.commands.executeCommand(`revealFileInOS`, vscode.Uri.file(rootPath));
          }
        });
      }
    }
  );
}
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
