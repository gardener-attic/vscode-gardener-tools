//
// Copyright (c) 2019 by SAP SE or an SAP affiliate company. All rights reserved. This file is licensed under the Apache Software License, v. 2 except as noted otherwise in the LICENSE file
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

'use strict'

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode')
const k8s = require('vscode-kubernetes-tools-api')
const _ = require('lodash')
const urljoin = require('url-join')
const fs = require('fs')
const tmp = require('tmp')
const shellEsacpe = require('shell-escape')


const {
  GardenerTreeProvider,
  nodeType
} = require('./gardener/gardener-tree')
const {
  SecretClient,
  NodeClient
} = require('./gardener/client')
const {
  configForLandscape,
  decodeBase64
} = require('./gardener/utils')
const {
  K8S_RESOURCE_SCHEME,
  kubefsUri,
  KubernetesResourceVirtualFileSystemProvider
} = require('./gardener/virtualfs')
const {
  GardenctlImpl
} = require('./gardener/vscodeUtils')

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

tmp.setGracefulCleanup() // cleanup temporary files even when an uncaught exception occurs
const explorer = new GardenerTreeProvider()
let cloudExplorer
let gardenctlInst

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  const clusterExplorerAPI = await k8s.extension.cloudExplorer.v1
  if (clusterExplorerAPI.available) {
    cloudExplorer = clusterExplorerAPI.api
    cloudExplorer.registerCloudProvider({
      cloudName: "Gardener",
      treeDataProvider: explorer,
      getKubeconfigYaml: getKubeconfig
    })

    const kubectl = await k8s.extension.kubectl.v1
    if (!kubectl.available) {
      throw new Error('kubectl not available')
    }
    const resourceDocProvider = new KubernetesResourceVirtualFileSystemProvider(kubectl, vscode.workspace.rootPath)

    const subscriptions = [
      vscode.commands.registerCommand('vs-gardener.showInDashboard', showInDashboard),
      vscode.commands.registerCommand('vs-gardener.createShoot', createShoot),
      vscode.commands.registerCommand('vs-gardener.createProject', createProject),
      vscode.commands.registerCommand('vs-gardener.loadResource', loadResource),
      vscode.commands.registerCommand('vs-gardener.target', target),
      vscode.commands.registerCommand('vs-gardener.shell', shell),
      vscode.workspace.registerFileSystemProvider(K8S_RESOURCE_SCHEME, resourceDocProvider, { /* TODO: case sensitive? */ })
    ]

    context.subscriptions.push(...subscriptions)
    gardenctlInst = new GardenctlImpl()
  } else {
    vscode.window.showWarningMessage(clusterExplorerAPI.reason)
  }
}
exports.activate = activate

/*
  @param target has either project or landscape property
*/
async function loadResource(target) {
  const kubeconfig = getKubeconfigPathFromTarget(target)
  const namespace = getNamespaceFromTarget(target)
  const name = target.name

  const outputFormat = 'yaml'
  const value = `${target.kindPlural}/${name}`
  const uri = kubefsUri(namespace, value, kubeconfig, outputFormat)
  try {
    const doc = await vscode.workspace.openTextDocument(uri)
    if (doc) {
      vscode.window.showTextDocument(doc)
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Error loading document: ${err}`)
  }
}

function getKubeconfigPathFromTarget(target) {
  return _.get(target, 'project.landscape.kubeconfig', _.get(target, 'landscape.kubeconfig'))
}

function getNamespaceFromTarget(target) {
  return _.get(target, 'project.namespace')
}

function showInDashboard(commandTarget) {
  const node = getNode(commandTarget)
  const targetNodeType = _.get(node, 'nodeType')
  const targetChildType = _.get(node, 'childType')

  switch (targetNodeType) {
    case nodeType.NODE_TYPE_SHOOT:
      showShootInDashboard(node)
      break
    case nodeType.NODE_TYPE_FOLDER:
      if (targetChildType === nodeType.NODE_TYPE_SHOOT) {
        showShootsInDashboard(node)
      }
      break
    case nodeType.NODE_TYPE_PROJECT:
      showProjectInDashboard(node)
      break
    case nodeType.NODE_TYPE_LANDSCAPE:
      showLandscapeInDashboard(node)
      break
  }
}

function showShootInDashboard(shootNode) {
  const landscapeName = _.get(shootNode, 'project.landscape.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const name = _.get(shootNode, 'name')
  const namespace = _.get(shootNode, 'project.namespace')

  const uri = urljoin(dashboardUrl, '/namespace/', namespace, '/shoots/', name)
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function showShootsInDashboard(node) {
  const landscapeName = _.get(node, 'parent.landscape.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const namespace = _.get(node, 'parent.namespace')

  const uri = urljoin(dashboardUrl, '/namespace/', namespace, '/shoots')
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function showProjectInDashboard(projectNode) {
  const landscapeName = _.get(projectNode, 'landscape.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const namespace = _.get(projectNode, 'namespace')

  const uri = urljoin(dashboardUrl, '/namespace/', namespace, '/administration')
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function showLandscapeInDashboard(node) {
  const landscapeName = _.get(node, 'name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const uri = urljoin(dashboardUrl)
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

async function shell(commandTarget) {
  const node = getNode(commandTarget)
  const targetNodeType = _.get(node, 'nodeType')
  const supportedTypes = [nodeType.NODE_TYPE_SHOOT, nodeType.NODE_TYPE_SEED]
  if (!_.includes(supportedTypes, targetNodeType)) {
    return
  }

  let cleanupCallback = () => { }
  try {
    const name = _.get(node, 'name')
    const landscapeName = getLandscapeNameFromNode(node)
    const kubeconfig = await getKubeconfig(node)
    const projectName = getProjectNamespaceFromNode(node) // TODO project name
    const kubeconfigTempObj = await writeKubeconfigToTempfile(kubeconfig)
    cleanupCallback = kubeconfigTempObj.cleanupCallback

    const clusterNode = await selectNode(kubeconfigTempObj.filePath)
    cleanupCallback() // cleanup kubeconfig tempfile
    if (!clusterNode) {
      return
    }
    if (targetNodeType === nodeType.NODE_TYPE_SHOOT) {
      await targetShoot(landscapeName, projectName, name, false)
    } else {
      await targetSeed(landscapeName, name, false)
    }

    const gardenName = getGardenName(landscapeName)
    await openShell(gardenName, projectName, targetNodeType, name, clusterNode)
  } catch (error) {
    cleanupCallback()
    vscode.window.showErrorMessage(error.message)
  }
}

async function selectNode(kubeconfig) {
  const nodeClient = new NodeClient(kubeconfig)
  const nodes = await nodeClient.list()

  if (_.isEmpty(nodes)) {
    vscode.window.showInformationMessage('This cluster currently does not have any nodes')
    return null;
  }

  const pickItems = _.map(nodes, node => {
    return {
      label: node.metadata.name,
      description: '',
      detail: '', // TODO stringify
      node: node.metadata.name
    }
  })

  const value = await vscode.window.showQuickPick(pickItems, { placeHolder: "Select node" });

  if (!value) {
    return null;
  }

  return value.node;
}

async function openShell(gardenName, projectName = undefined, clusterType, clusterName, clusterNode) {
  const terminalShellCmd = ['shell', clusterNode];
  let terminalName = `shell on ${gardenName}`
  if (projectName) {
    terminalName += `/${projectName}`
  }
  terminalName += `/${clusterType}/${clusterName}/${clusterNode}`

  await gardenctlInst.runAsTerminal(terminalShellCmd, terminalName);
}

async function target(commandTarget) {
  try {
    const node = getNode(commandTarget)
    const targetNodeType = _.get(node, 'nodeType')

    switch (targetNodeType) {
      case nodeType.NODE_TYPE_SHOOT:
        await targetShootNode(node)
        break
      case nodeType.NODE_TYPE_SEED:
        await targetSeedNode(node)
        break
      case nodeType.NODE_TYPE_PROJECT:
        await targetProjectNode(node)
        break
      case nodeType.NODE_TYPE_LANDSCAPE:
        await targetLandscape(getLandscapeNameFromNode(node))
        break
    }
  } catch (error) {
    vscode.window.showErrorMessage(error.message)
  }
}

async function targetProjectNode(node, inTerminal = true) {
  const landscapeName = getLandscapeNameFromNode(node)
  const projectName = getProjectNamespaceFromNode(node) // TODO projectName
  return targetProject(landscapeName, projectName, inTerminal)
}

async function targetShootNode(node, inTerminal = true) {
  const name = _.get(node, 'name')
  const landscapeName = getLandscapeNameFromNode(node)
  const projectName = getProjectNamespaceFromNode(node)
  return targetShoot(landscapeName, projectName, name, inTerminal)
}

async function targetSeedNode(node, inTerminal = true) {
  const name = _.get(node, 'name')
  const landscapeName = getLandscapeNameFromNode(node)
  return targetSeed(landscapeName, name, inTerminal)
}

function getLandscapeNameFromNode(node) {
  return _.get(node, 'project.landscape.name',
    _.get(node, 'landscape.name',
      _.get(node, 'name')
    )
  )
}

function getProjectNamespaceFromNode(node) {
  return _.get(node, 'project.namespace',
    _.get(node, 'namespace')
  )
}

async function targetLandscape(landscapeName, inTerminal = true) {
  const gardenName = getGardenName(landscapeName)

  if (inTerminal) {
    return gardenctlInst.invokeInSharedTerminal(shellEsacpe(['target', 'garden', gardenName]))
  }

  return gardenctlInst.invoke(gardenctlInst.getShell().target.garden, gardenName)
}

async function targetProject(landscapeName, projectNamespace, inTerminal = true) {
  await targetLandscape(landscapeName, false)
  if (inTerminal) {
    return gardenctlInst.invokeInSharedTerminal(shellEsacpe(['target', 'project', projectNamespace])) // TODO change to project name once supported by gardenctl
  }
  return gardenctlInst.invoke(gardenctlInst.getShell().target.project, projectNamespace)
}

async function targetShoot(landscapeName, projectNamespace, name, inTerminal = true) {
  await targetProject(landscapeName, projectNamespace, false) // TODO currently gardenctl does not allow to set garden and project as options so we need to target it one by one
  if (inTerminal) {
    return gardenctlInst.invokeInSharedTerminal(shellEsacpe(['target', 'shoot', name]))
  }
  return gardenctlInst.invoke(gardenctlInst.getShell().target.shoot, name)
}

async function targetSeed(landscapeName, name, inTerminal = true) {
  await targetLandscape(landscapeName, false)
  if (inTerminal) {
    return gardenctlInst.invokeInSharedTerminal(shellEsacpe(['target', 'seed', name]))
  }
  return gardenctlInst.invoke(gardenctlInst.getShell().target.seed, name)
}

function createShoot(commandTarget) {
  const folderNode = getNode(commandTarget, "folder")

  const landscapeName = _.get(folderNode, 'parent.landscape.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const namespace = _.get(folderNode, 'parent.namespace')

  const uri = urljoin(dashboardUrl, '/namespace/', namespace, '/shoots/+')
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function createProject(commandTarget) {
  const projectFolder = getNode(commandTarget, "folder")

  const landscapeName = _.get(projectFolder, 'parent.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const uri = urljoin(dashboardUrl, '/namespace/+')
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function getDashboardUrl(landscapeName) {
  const config = configForLandscape(landscapeName)
  const dashboardUrl = _.get(config, 'dashboardUrl')
  if (!dashboardUrl) {
    vscode.window.showWarningMessage(`No dashboard URL configured for landscape name ${landscapeName}`)
    return undefined
  }
  return dashboardUrl
}

function getGardenName(landscapeName) {
  const config = configForLandscape(landscapeName)
  return _.get(config, 'gardenName', landscapeName)
}

function getNode(commandTarget, type = undefined) {
  let node = _.get(resolveCommand(commandTarget), 'cloudResource')
  if (!node) {
    return
  }

  if (!type) {
    return node
  }
  if (_.get(node, 'nodeType') !== type) {
    return
  }
  return node
}

function resolveCommand(commandTarget) {
  if (!commandTarget) {
    return undefined
  }
  if (!cloudExplorer) {
    return undefined
  }
  return cloudExplorer.resolveCommandTarget(commandTarget)
}

async function getKubeconfig(target) {
  const clusterNodeTypes = [nodeType.NODE_TYPE_SHOOT, nodeType.NODE_TYPE_PLANT, nodeType.NODE_TYPE_SEED]
  if (_.includes(clusterNodeTypes, target.nodeType)) {
    return await getClusterTypeKubeconfig(target)
  } else if (target.nodeType === nodeType.NODE_TYPE_LANDSCAPE) {
    return await getLandscapeKubeconfig(target)
  } else {
    return undefined
  }
}

async function writeKubeconfigToTempfile(kubeconfig) {
  return new Promise(function (resolve, reject) {
    tmp.file(function _tempFileCreated(err, filePath, fd, cleanupCallback) {
      if (err) {
        reject(err)
      }
      const options = {
        encoding: 'utf8'
      }
      fs.writeFile(filePath, kubeconfig, options, err => {
        if (err) {
          reject(err)
        }
        resolve({
          filePath,
          cleanupCallback
        })
      })
    })
  })
}

async function getLandscapeKubeconfig(landscape) {
  const kubeconfigPath = landscape.kubeconfig
  return new Promise(function (resolve, reject) {
    fs.readFile(kubeconfigPath, "utf8", (err, data) => {
      err ? reject(err) : resolve(data)
    })
  })
}

async function getClusterTypeKubeconfig(target) {
  const kubeconfig = getKubeconfigPathFromTarget(target)
  const namespace = target.kubeconfigSecretNamespace
  const secretClient = new SecretClient(kubeconfig, namespace)
  const secret = await secretClient.get(target.kubeconfigSecretName)
  return decodeBase64(_.get(secret, 'data.kubeconfig'))
}

// this method is called when your extension is deactivated
function deactivate() { }

module.exports = {
  activate,
  deactivate
}