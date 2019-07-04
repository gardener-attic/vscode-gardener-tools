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

const vscode = require('vscode')
const k8s = require('vscode-kubernetes-tools-api')
const path = require('path')
const _ = require('lodash')
const {
  ProjectClient,
  ShootClient,
  PlantClient,
  SeedClient,
  CloudProfileClient,
  SelfSubjectAccessReviewClient
} = require('./client')

const nodeType = {
  NODE_TYPE_SHOOT: 'shoot',
  NODE_TYPE_SEED: 'seed',
  NODE_TYPE_PLANT: 'plant',
  NODE_TYPE_PROJECT: 'project',
  NODE_TYPE_LANDSCAPE: 'landscape',
  NODE_TYPE_FOLDER: 'folder',
  NODE_TYPE_CLUSTER_TYPE: 'clusterType',
  NODE_TYPE_ERROR: 'error'
}

class GardenerTreeProvider {
  constructor () {
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
  }

  getTreeItem (element) {
    if (element.nodeType === nodeType.NODE_TYPE_ERROR) {
      return new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None)
    } else if (element.nodeType === nodeType.NODE_TYPE_LANDSCAPE) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.Collapsed)
      treeItem.iconPath = vscode.Uri.file(path.join(__dirname, '../assets/gardener-logo.svg'))
      treeItem.contextValue = `gardener.landscape ${k8s.CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_PROJECT) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.Collapsed)
      treeItem.contextValue = 'gardener.project'
      treeItem.tooltip = projectTooltip(element)
      treeItem.command = getLoadResourceCommand(element)
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_FOLDER) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.Collapsed)
      const folderIcon = getFolderIcon(element.childType)
      if (folderIcon) {
        treeItem.iconPath = vscode.Uri.file(path.join(__dirname, '../assets/', folderIcon))
      }
      treeItem.contextValue = `gardener.folder.${element.childType}`
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_SHOOT) {
      let label = element.name
      if (element.hibernated) {
        label = `${label} (zZz)`
      }
      const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None)
      const hibernated = element.hibernated ? '.hibernated' : ''
      treeItem.contextValue = `gardener.shoot${hibernated} ${k8s.CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`
      treeItem.command = getLoadResourceCommand(element)
      treeItem.iconPath = infraIcon(element.cloudType)
      treeItem.tooltip = shootTooltip(element)
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_PLANT) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.None)
      treeItem.contextValue = `gardener.plant ${k8s.CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`
      treeItem.command = getLoadResourceCommand(element)
      treeItem.iconPath = infraIcon(element.cloudType)
      treeItem.tooltip = plantTooltip(element)
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_SEED) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.None)
      treeItem.contextValue = `gardener.seed ${k8s.CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`
      treeItem.command = getLoadResourceCommand(element)
      treeItem.iconPath = infraIcon(element.cloudType)
      treeItem.tooltip = seedTooltip(element)
      return treeItem
    }
  }

  getChildren (element) {
    if (!element) {
      return landscapes()
    } else if (element.nodeType === nodeType.NODE_TYPE_LANDSCAPE) {
      return clusterScopedResources(element)
    } else if (element.childType === nodeType.NODE_TYPE_PROJECT) {
      return projects(element)
    } else if (element.childType === nodeType.NODE_TYPE_CLUSTER_TYPE) {
      return clusterTypes(element)
    } else if (element.childType === nodeType.NODE_TYPE_SHOOT) {
      return shoots(element)
    } else if (element.childType === nodeType.NODE_TYPE_PLANT) {
      return plants(element)
    } else if (element.childType === nodeType.NODE_TYPE_SEED) {
      return seeds(element)
    } else {
      return []
    }
  }
}

module.exports = { GardenerTreeProvider, nodeType }

function getLoadResourceCommand (element) {
  return {
    command: 'vs-gardener.loadResource',
    title: 'Load',
    arguments: [
      element
    ]
  }
}

function getDisplayName (element) {
  return element.displayName || element.name
}

async function landscapes () {
  const config = vscode.workspace.getConfiguration('vscode-gardener-tools', null)
  const landscapes = _.get(config, 'landscapes')
  return _.map(landscapes, landscape => {
    const { name, kubeconfigPath } = landscape
    return asLandscapeTreeNode(name, kubeconfigPath)
  })
}

function asLandscapeTreeNode (name, kubeconfig) {
  return {
    nodeType: nodeType.NODE_TYPE_LANDSCAPE,
    name,
    kubeconfig
  }
}

async function clusterScopedResources (landscape) {
  const accessReview = new SelfSubjectAccessReviewClient(landscape.kubeconfig)
  const canIGetSeeds = await accessReview.canI('get', 'seeds')
  const clusterScopedResources = [
    toFolderTreeNode(landscape, 'Projects', nodeType.NODE_TYPE_PROJECT)
  ]
  if (canIGetSeeds) {
    clusterScopedResources.push(toFolderTreeNode(landscape, 'Seeds', nodeType.NODE_TYPE_SEED))
  }
  return clusterScopedResources
}

async function projects ({ parent: landscape }) {
  const projectClient = new ProjectClient(landscape.kubeconfig, landscape.name)
  const projects = await projectClient.list()
  return _.map(projects, project => {
    return toProjectTreeNode(landscape, project)
  })
}

function toProjectTreeNode (landscape, project) {
  const name = _.get(project, 'metadata.name')
  return {
    nodeType: nodeType.NODE_TYPE_PROJECT,
    childType: nodeType.NODE_TYPE_CLUSTER_TYPE,
    kindPlural: 'projects',
    name,
    landscape,
    displayName: _.toUpper(name),
    namespace: _.get(project, 'spec.namespace'),
    description: _.get(project, 'spec.description', '-none-'),
    owner: _.get(project, 'spec.owner.name')
  }
}

function projectTooltip (element) {
  const list = [
    `Project: ${element.name}`,
    `Owner: ${element.owner}`,
    `Description: ${element.description}`
  ]
  return list.join('\n')
}

function clusterTypes (project) {
  return [
    toFolderTreeNode(project, 'Shoots', nodeType.NODE_TYPE_SHOOT),
    toFolderTreeNode(project, 'Plants', nodeType.NODE_TYPE_PLANT)
  ]
}

function toFolderTreeNode (parent, name, childType) {
  return {
    nodeType: nodeType.NODE_TYPE_FOLDER,
    childType,
    name,
    parent
  }
}

async function shoots ({ parent: project }) {
  const shootClient = new ShootClient(project.landscape.kubeconfig, project.namespace)
  const shoots = await shootClient.list()
  return _.map(shoots, shoot => {
    return toShootTreeNode(project, shoot)
  })
}

function toShootTreeNode (project, shoot) {
  const name = _.get(shoot, 'metadata.name')
  return {
    nodeType: nodeType.NODE_TYPE_SHOOT,
    kindPlural: 'shoots',
    name,
    project,
    kubeconfigSecretName: `${name}.kubeconfig`,
    kubeconfigSecretNamespace: project.namespace,
    cloudType: getCloudType(_.get(shoot, 'spec.cloud')),
    hibernated: _.get(shoot, 'spec.hibernation.enabled', false),
    version: _.get(shoot, 'spec.kubernetes.version'),
    purpose: _.get(shoot, ['metadata', 'annotations', 'garden.sapcloud.io/purpose'], '-none-'),
    createdBy: _.get(shoot, ['metadata', 'annotations', 'garden.sapcloud.io/createdBy'])
  }
}

function shootTooltip (element) {
  const list = [
    `Shoot: ${element.name}`,
    `Kubernetes Version: ${element.version}`,
    `Created By: ${element.createdBy}`,
    `Purpose: ${element.purpose}`
  ]
  return list.join('\n')
}

async function plants ({ parent: project }) {
  const plant = new PlantClient(project.landscape.kubeconfig, project.namespace)
  const plants = await plant.list()
  return _.map(plants, plant => {
    return toPlantTreeNode(project, plant)
  })
}

function toPlantTreeNode (project, plant) {
  const name = _.get(plant, 'metadata.name')
  return {
    nodeType: nodeType.NODE_TYPE_PLANT,
    kindPlural: 'plants',
    name,
    project,
    kubeconfigSecretName: _.get(plant, 'spec.secretRef.name'),
    kubeconfigSecretNamespace: _.get(plant, 'spec.secretRef.namespace', project.namespace),
    cloudType: _.get(plant, 'status.clusterInfo.cloud.type'),
    region: _.get(plant, 'status.clusterInfo.cloud.region'),
    version: _.get(plant, 'status.clusterInfo.kubernetes.version'),
    createdBy: _.get(plant, ['metadata', 'annotations', 'garden.sapcloud.io/createdBy']),
    endpoints: _.get(plant, 'spec.endpoints'),
  }
}

function plantTooltip (element) {
  const list = [
    `Plant: ${element.name}`,
    `Cloud: ${element.cloudType}/${element.region}`,
    `Kubernetes Version: ${element.version}`,
    `Created By: ${element.createdBy}`
  ]
  return list.join('\n')
}

async function seeds ({ parent: landscape }) {
  const seedClient = new SeedClient(landscape.kubeconfig)
  const cloudProfilesClient = new CloudProfileClient(landscape.kubeconfig)
  const [
    seeds,
    cloudProfiles
  ] = await Promise.all([
    seedClient.list(),
    cloudProfilesClient.list()
  ])
  return _.map(seeds, seed => {
    const cloudProfile = _.find(
      cloudProfiles,
      cloudProfile => cloudProfile.metadata.name === _.get(seed, 'spec.cloud.profile')
    )
    return toSeedTreeNode(landscape, seed, cloudProfile)
  })
}

function toSeedTreeNode (landscape, seed, cloudProfile) {
  const name = _.get(seed, 'metadata.name')
  return {
    nodeType: nodeType.NODE_TYPE_SEED,
    kindPlural: 'seeds',
    name,
    landscape,
    kubeconfigSecretName: _.get(seed, 'spec.secretRef.name'),
    kubeconfigSecretNamespace: _.get(seed, 'spec.secretRef.namespace'),
    cloudType: getCloudType(_.get(cloudProfile, 'spec')),
    region: _.get(seed, 'spec.cloud.region', ''),
    visible: _.get(seed, 'spec.visible'),
    protected: _.get(seed, 'spec.protected')
  }
}

function seedTooltip (element) {
  const list = [
    `Seed: ${element.name}`,
    `Cloud: ${element.cloudType}/${element.region}`,
    `Visible: ${element.visible}`,
    `Protected: ${element.protected}`
  ]
  return list.join('\n')
}

function getCloudType (object) {
  const cloudTypes = [
    'aws',
    'azure',
    'gcp',
    'openstack',
    'alicloud'
  ]
  return _.head(_.intersection(_.keys(object), cloudTypes))
}

function infraIcon (cloudType) {
  const color = iconColor()
  let logo
  switch (cloudType) {
    case 'aws':
      logo = `aws-${color}.svg`
      break
    case 'azure':
      logo = `azure-${color}.svg`
      break
    case 'gcp':
      logo = `gcp-${color}.svg`
      break
    case 'openstack':
      logo = `openstack-${color}.svg`
      break
    case 'alicloud':
      logo = `alicloud-${color}.svg`
      break
    case 'gce':
      logo = `gce-${color}.svg`
      break
    case 'gke':
      logo = `gke-${color}.svg`
      break
    default:
      return undefined
  }
  return vscode.Uri.file(path.join(__dirname, `../assets/${logo}`))
}

function iconColor () {
  const config = vscode.workspace.getConfiguration('vscode-gardener-tools', null)
  const lightTheme = _.get(config, 'vscode-light-theme', true)
  if (lightTheme) {
    return 'black'
  }
  return 'white'
}

function getFolderIcon (type) {
  const color = iconColor()
  switch (type) {
    case nodeType.NODE_TYPE_SHOOT:
      return `shoot-${color}.svg`
    case nodeType.NODE_TYPE_PLANT:
      return `plant-${color}.svg`
    case nodeType.NODE_TYPE_SEED:
      return `seed-${color}.svg`
    case nodeType.NODE_TYPE_PROJECT:
      return `project-${color}.svg`
    default:
      return undefined
  }
}
