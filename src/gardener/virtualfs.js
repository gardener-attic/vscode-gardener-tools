// forked from https://github.com/Azure/vscode-kubernetes-tools/blob/master/src/kuberesources.virtualfs.ts

//
// MIT License
//
// Copyright (c) Microsoft Corporation. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE
//

const { Uri, FileType, EventEmitter, Disposable } = require('vscode')
const path = require('path')
const fs = require('fs')
const querystring = require('querystring')
const vscode = require('vscode')

const K8S_RESOURCE_SCHEME = 'gardener'
const KUBECTL_RESOURCE_AUTHORITY = 'loadkubernetescore'

function kubefsUri(namespace, value, kubeconfigPath, outputFormat) {
    const docname = `${value.replace('/', '-')}.${outputFormat}`
    const nonce = new Date().getTime()
    const nsquery = namespace ? `ns=${namespace}&` : ''
    const uri = `${K8S_RESOURCE_SCHEME}://${KUBECTL_RESOURCE_AUTHORITY}/${docname}?${nsquery}value=${value}&kubeconfigPath=${kubeconfigPath}&_=${nonce}`
    return Uri.parse(uri)
}

class KubernetesResourceVirtualFileSystemProvider {
    constructor(kubectl) {
      this.kubectl = kubectl

      this.onDidChangeFileEmitter = new EventEmitter()

      this.onDidChangeFile = this.onDidChangeFileEmitter.event
    }

    watch(_uri, _options) {
        // It would be quite neat to implement this to watch for changes
        // in the cluster and update the doc accordingly.  But that is very
        // definitely a future enhancement thing!
        return new Disposable(() => {})
    }

    stat(_uri) {
        return {
            type: FileType.File,
            ctime: 0,
            mtime: 0,
            size: 65536  // These files don't seem to matter for us
        }
    }

    readDirectory(_uri) {
        return []
    }

    createDirectory(_uri){
        // no-op
    }

    readFile(uri) {
        return this.readFileAsync(uri)
    }

    async readFileAsync(uri) {
        const content = await this.loadResource(uri)
        return new Buffer.from(content, 'utf8')
    }

    async loadResource(uri) {
        const query = querystring.parse(uri.query)

        const outputFormat = 'yaml'
        const value = query.value
        const ns = query.ns
        const kubeconfigPath = query.kubeconfigPath
        const resourceAuthority = uri.authority

        const sr = await this.execLoadResource(resourceAuthority, ns, value, kubeconfigPath, outputFormat)

        if (!sr || sr.code !== 0) {
            const message = sr ? sr.stderr : 'Unable to run command line tool'
            vscode.window.showErrorMessage('Get command failed: ' + message)
            throw message
        }

        return sr.stdout
    }

    async execLoadResource(resourceAuthority, ns, value, kubeconfigPath, outputFormat) {
        switch (resourceAuthority) {
            case KUBECTL_RESOURCE_AUTHORITY:
                const nsarg = ns ? `--namespace ${ns}` : ''
                return await await this.kubectl.api.invokeCommand(`--kubeconfig ${kubeconfigPath} -o ${outputFormat} ${nsarg} get ${value}`)
            default:
                return { code: -99, stdout: '', stderr: `Internal error: please raise an issue with the error code InvalidObjectLoadURI and report authority ${resourceAuthority}.` }
        }
    }

    writeFile(uri, content, _options){
        return this.saveAsync(uri, content)  // TODO: respect options
    }

    async saveAsync(uri, content) {
        // This assumes no pathing in the URI - if this changes, we'll need to
        // create subdirectories.
        // TODO: not loving prompting as part of the write when it should really be part of a separate
        // 'save' workflow - but needs must, I think
        const rootPath = await selectRootFolder()
        if (!rootPath) {
            return
        }
        const fspath = path.join(rootPath, uri.fsPath)
        fs.writeFileSync(fspath, content)
    }

    delete(_uri, _options){
        // no-op
    }

    rename(_oldUri, _newUri, _options){
        // no-op
    }
}

async function selectRootFolder() {
  const folder = await showWorkspaceFolderPick()
  if (!folder) {
      return undefined
  }
  if (folder.uri.scheme !== 'file') {
      vscode.window.showErrorMessage('This command requires a filesystem folder')  // TODO: make it not
      return undefined
  }
  return folder.uri.fsPath
}

async function showWorkspaceFolderPick() {
  if (!vscode.workspace.workspaceFolders) {
      vscode.window.showErrorMessage('This command requires an open folder.');
      return undefined;
  } else if (vscode.workspace.workspaceFolders.length === 1) {
      return vscode.workspace.workspaceFolders[0];
  }
  return await vscode.window.showWorkspaceFolderPick();
}

module.exports = {
  K8S_RESOURCE_SCHEME,
  kubefsUri,
  KubernetesResourceVirtualFileSystemProvider
}