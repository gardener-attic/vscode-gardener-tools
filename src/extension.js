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

const {
  GardenerTreeProvider,
  nodeType
} = require('./gardener/gardener-tree')
const {
  SecretClient
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

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

const explorer = new GardenerTreeProvider()
let cloudExplorer

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
      vscode.workspace.registerFileSystemProvider(K8S_RESOURCE_SCHEME, resourceDocProvider, { /* TODO: case sensitive? */ })
    ]

    context.subscriptions.push(...subscriptions)
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
  const targetNodeType = _.get(node, 'cloudResource.nodeType')

  switch (targetNodeType) {
    case nodeType.NODE_TYPE_SHOOT:
      showShootInDashboard(node)
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
  const landscapeName = _.get(shootNode, 'cloudResource.project.landscape.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const name = _.get(shootNode, 'cloudResource.name')
  const namespace = _.get(shootNode, 'cloudResource.project.namespace')

  const uri = urljoin(dashboardUrl, '/namespace/', namespace, '/shoots/', name)
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function showProjectInDashboard(projectNode) {
  const landscapeName = _.get(projectNode, 'cloudResource.landscape.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const namespace = _.get(projectNode, 'cloudResource.namespace')

  const uri = urljoin(dashboardUrl, '/namespace/', namespace, '/shoots')
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function showLandscapeInDashboard(projectNode) {
  const landscapeName = _.get(projectNode, 'cloudResource.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const uri = urljoin(dashboardUrl)
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function createShoot (commandTarget) {
  const shootNode = getNode(commandTarget, "project")

  const landscapeName = _.get(shootNode, 'cloudResource.landscape.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const namespace = _.get(shootNode, 'cloudResource.namespace')

  const uri = urljoin(dashboardUrl, '/namespace/', namespace, '/shoots/create/ui')
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function createProject (commandTarget) {
  const shootNode = getNode(commandTarget, "landscape")

  const landscapeName = _.get(shootNode, 'cloudResource.name')
  const dashboardUrl = getDashboardUrl(landscapeName)
  if (!dashboardUrl) {
    return
  }

  const uri = urljoin(dashboardUrl, '/namespace/create/ui')
  vscode.env.openExternal(vscode.Uri.parse(uri, true))
}

function getDashboardUrl (landscapeName) {
  const config = configForLandscape(landscapeName)
  const dashboardUrl = _.get(config, 'dashboardUrl')
  if (!dashboardUrl) {
    vscode.window.showWarningMessage(`No dashboard URL configured for landscape name ${landscapeName}`)
    return undefined
  }
  return dashboardUrl
}

function getNode(commandTarget, type = undefined) {
  const node = resolveCommand(commandTarget)
  if (!node) {
    return
  }

  if (!type) {
    return node
  }
  if (_.get(node, 'cloudResource.nodeType') !== type) {
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

async function getLandscapeKubeconfig(landscape) {
  const kubeconfigPath = landscape.kubeconfig
  return new Promise(function(resolve, reject){
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
function deactivate() {}

module.exports = {
	activate,
	deactivate
}