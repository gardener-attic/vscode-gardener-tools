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
  BackupBucketClient,
  BackupEntryClient,
  SeedClient,
  SelfSubjectAccessReviewClient,
  SelfSubjectRulesReviewClient,
  GKVEnum
} = require('./client')
const { canI } = require('./utils')

const nodeType = {
  NODE_TYPE_SHOOT: 'shoot',
  NODE_TYPE_SEED: 'seed',
  NODE_TYPE_PLANT: 'plant',
  NODE_TYPE_PROJECT: 'project',
  NODE_TYPE_LANDSCAPE: 'landscape',
  NODE_TYPE_FOLDER: 'folder',
  NODE_TYPE_PROJECT_RESOURCE: 'projectResource',
  NODE_TYPE_BACKUP_BUCKET: 'backupBucket',
  NODE_TYPE_BACKUP_ENTRY: 'backupEntry',
  NODE_TYPE_ERROR: 'error',
  NODE_TYPE_MISSING_CONFIGURATION: 'missingConfig',
}

class GardenerTreeProvider {
  constructor () {
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
  }

  setIsGardenCtlPresent(value) {
    this.isGardenCtlPresent = value
  }

  targetableContextValue() {
    return this.isGardenCtlPresent ? ' gardener.targetable' : ''
  }

  listableContextValue() {
    return this.isGardenCtlPresent ? ' gardener.listable' : ''
  }

  shellableContextValue(hibernated) {
    return this.isGardenCtlPresent && !hibernated ? ' gardener.shellable' : ''
  }

  getTreeItem (element) {
    if (element.nodeType === nodeType.NODE_TYPE_ERROR) {
      return new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None)
    } if (element.nodeType === nodeType.NODE_TYPE_MISSING_CONFIGURATION) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.None)
      treeItem.contextValue = 'gardener.configurable'
      treeItem.command = {
        command: 'vs-gardener.openExtensionSettings',
        title: 'Configure',
        arguments: []
      }
      treeItem.iconPath = settingsIcon()
      treeItem.tooltip = element.tooltip
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_LANDSCAPE) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.Collapsed)
      treeItem.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'assets', 'gardener-logo.svg'))
      treeItem.contextValue = [
        'gardener.landscape',
        this.targetableContextValue(),
        this.listableContextValue(),
        k8s.CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT
      ].join(',')
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_PROJECT) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.Collapsed)
      treeItem.contextValue = [
        'gardener.project',
        this.targetableContextValue(),
        this.listableContextValue()
      ].join(',')
      treeItem.tooltip = projectTooltip(element)
      treeItem.command = getLoadResourceCommand(element)
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_FOLDER) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.Collapsed)
      const folderIcon = getFolderIcon(element.childType)
      if (folderIcon) {
        treeItem.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'assets', folderIcon))
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
      treeItem.contextValue = [
        `gardener.shoot${hibernated}`,
        this.targetableContextValue(),
        this.listableContextValue(),
        this.shellableContextValue(element.hibernated),
        k8s.CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT
      ].join(',')
      treeItem.command = getLoadResourceCommand(element)
      treeItem.iconPath = infraIcon(element.providerType)
      treeItem.tooltip = shootTooltip(element)
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_PLANT) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.None)
      treeItem.contextValue = [
        'gardener.plant',
        k8s.CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT
      ].join(',')
      treeItem.command = getLoadResourceCommand(element)
      treeItem.iconPath = infraIcon(element.providerType)
      treeItem.tooltip = plantTooltip(element)
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_SEED) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.None)
      treeItem.contextValue = [
        'gardener.seed',
        this.targetableContextValue(),
        this.listableContextValue(),
        this.shellableContextValue(false),
        k8s.CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT
      ].join(',')
      treeItem.command = getLoadResourceCommand(element)
      treeItem.iconPath = infraIcon(element.providerType)
      treeItem.tooltip = seedTooltip(element)
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_BACKUP_BUCKET) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.None)
      treeItem.contextValue = 'gardener.backupbucket'
      treeItem.command = getLoadResourceCommand(element)
      treeItem.iconPath = infraIcon(element.providerType)
      treeItem.tooltip = backupBucketTooltip(element)
      return treeItem
    } else if (element.nodeType === nodeType.NODE_TYPE_BACKUP_ENTRY) {
      const treeItem = new vscode.TreeItem(getDisplayName(element), vscode.TreeItemCollapsibleState.None)
      treeItem.contextValue = 'gardener.backupentry'
      treeItem.command = getLoadResourceCommand(element)
      treeItem.iconPath = infraIcon(element.providerType)
      treeItem.tooltip = backupEntryTooltip(element)
      return treeItem
    }
  }

  async getChildren (element) {
    if (!element) {
      const landscapesTree = landscapes()
      if (!_.isEmpty(landscapesTree)) {
        return landscapesTree
      }
      return asMissingConfigTreeNode('Configuration Required', 'You need to configure the Gardener extension.\nClick to open Extension Settings.')
    } else if (element.nodeType === nodeType.NODE_TYPE_LANDSCAPE) {
      return clusterScopedResources(element)
    } else if (element.childType === nodeType.NODE_TYPE_PROJECT) {
      return projects(element)
    } else if (element.childType === nodeType.NODE_TYPE_PROJECT_RESOURCE) {
      return projectResources(element)
    } else if (element.childType === nodeType.NODE_TYPE_SHOOT) {
      return shoots(element)
    } else if (element.childType === nodeType.NODE_TYPE_PLANT) {
      return plants(element)
    } else if (element.childType === nodeType.NODE_TYPE_BACKUP_BUCKET) {
      return backupBuckets(element)
    } else if (element.childType === nodeType.NODE_TYPE_BACKUP_ENTRY) {
      return backupEntries(element)
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

function asMissingConfigTreeNode (name, tooltip = undefined) {
  return [{
    nodeType: nodeType.NODE_TYPE_MISSING_CONFIGURATION,
    name,
    tooltip
  }]
}

function asErrorTreeNode (message) {
  return [{
    nodeType: nodeType.NODE_TYPE_ERROR,
    message
  }]
}

function landscapes () {
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
  const rulesReview = new SelfSubjectRulesReviewClient(landscape.kubeconfig)
  const permissions = await rulesReview.getPermissions('*')

  const canIGetSeeds = canI(permissions, 'get', 'core.gardener.cloud', 'seeds')

  const clusterScopedResources = [
    toFolderTreeNode(landscape, 'Projects', nodeType.NODE_TYPE_PROJECT)
  ]
  if (canIGetSeeds) {
    clusterScopedResources.push(toFolderTreeNode(landscape, 'Seeds', nodeType.NODE_TYPE_SEED))
  }
  const canIGetBackupBuckets = canI(permissions, 'get', 'core.gardener.cloud', 'backupbuckets')
  if (canIGetBackupBuckets) {
    clusterScopedResources.push(toFolderTreeNode(landscape, 'BackupBuckets', nodeType.NODE_TYPE_BACKUP_BUCKET))
  }
  return clusterScopedResources
}

async function projects ({ parent: landscape }) {
  const rulesReview = new SelfSubjectRulesReviewClient(landscape.kubeconfig)
  const permissions = await rulesReview.getPermissions('*')

  const projectClient = new ProjectClient(landscape.kubeconfig, landscape.name, permissions)
  try {
    const projects = await projectClient.list()
    return _.map(projects, project => {
      return toProjectTreeNode(landscape, project)
    })
  } catch (error) {
    const message = _.get(error, 'message')
    if (message.includes('Forbidden')) {
      return asMissingConfigTreeNode('No permission to list projects. Specify the projects in the extension configuration.', 'The Kubeconfig provided does not have the permission to list projects.\nYou need to specify the projects that you want to see in the extension configuration')
    }
    return asErrorTreeNode(message || 'Failed to list projects')
  }
}

function toProjectTreeNode (landscape, project) {
  const name = _.get(project, 'metadata.name')
  return {
    nodeType: nodeType.NODE_TYPE_PROJECT,
    childType: nodeType.NODE_TYPE_PROJECT_RESOURCE,
    kindPlural: GKVEnum.PROJECTS,
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

async function projectResources (project) {
  const resources = [
    toFolderTreeNode(project, 'Shoots', nodeType.NODE_TYPE_SHOOT),
    toFolderTreeNode(project, 'Plants', nodeType.NODE_TYPE_PLANT)
  ]
  const accessReview = new SelfSubjectAccessReviewClient(project.landscape.kubeconfig)
  const canIGetBackupEntries = await accessReview.canI('get', GKVEnum.BACKUPENTRIES)
  if (canIGetBackupEntries) {
    resources.push(toFolderTreeNode(project, 'BackupEntries', nodeType.NODE_TYPE_BACKUP_ENTRY))
  }

  return resources
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
    kindPlural: GKVEnum.SHOOTS,
    name,
    project,
    kubeconfigSecretName: `${name}.kubeconfig`,
    kubeconfigSecretNamespace: project.namespace,
    providerType: _.get(shoot, 'spec.provider.type'),
    hibernated: _.get(shoot, 'status.hibernated', false),
    version: _.get(shoot, 'spec.kubernetes.version'),
    purpose: _.get(shoot, 'spec.purpose', '-none-'),
    createdBy: _.get(shoot, ['metadata', 'annotations', 'gardener.cloud/created-by']),
    seed: _.get(shoot, 'spec.seedName', '')
  }
}

function shootTooltip (element) {
  const list = [
    `Shoot: ${element.name}`,
    `Kubernetes Version: ${element.version}`,
    `Created By: ${element.createdBy}`,
    `Purpose: ${element.purpose}`,
    `Seed: ${element.seed}`
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
    kindPlural: GKVEnum.PLANTS,
    name,
    project,
    kubeconfigSecretName: _.get(plant, 'spec.secretRef.name'),
    kubeconfigSecretNamespace: _.get(plant, 'spec.secretRef.namespace', project.namespace),
    providerType: _.get(plant, 'status.clusterInfo.cloud.type'),
    region: _.get(plant, 'status.clusterInfo.cloud.region'),
    version: _.get(plant, 'status.clusterInfo.kubernetes.version'),
    createdBy: _.get(plant, ['metadata', 'annotations', 'garden.sapcloud.io/createdBy']),
    endpoints: _.get(plant, 'spec.endpoints'),
  }
}

function plantTooltip (element) {
  const list = [
    `Plant: ${element.name}`,
    `Provider: ${element.providerType}/${element.region}`,
    `Kubernetes Version: ${element.version}`,
    `Created By: ${element.createdBy}`
  ]
  return list.join('\n')
}

async function backupBuckets ({ parent: landscape }) {
  const backupBucket = new BackupBucketClient(landscape.kubeconfig)
  const backupBuckets = await backupBucket.list()
  return _.map(backupBuckets, backupBucket => {
    return toBackupBucketTreeNode(landscape, backupBucket)
  })
}

function toBackupBucketTreeNode (landscape, backupBucket) {
  const name = _.get(backupBucket, 'metadata.name')
  return {
    nodeType: nodeType.NODE_TYPE_BACKUP_BUCKET,
    kindPlural: GKVEnum.BACKUPBUCKETS,
    name,
    landscape,
    seed: _.get(backupBucket, 'spec.seedName'),
    region: _.get(backupBucket, 'spec.provider.region'),
    providerType: _.get(backupBucket, 'spec.provider.type'),
  }
}

function backupBucketTooltip (element) {
  const list = [
    `BackupBucket: ${element.name}`,
    `Seed: ${element.seed}`,
    `Region: ${element.region}`,
    `Provider: ${element.providerType}`
  ]
  return list.join('\n')
}

async function backupEntries ({ parent: project }) {
  const backupEntryClient = new BackupEntryClient(project.landscape.kubeconfig, project.namespace)
  const backupBucketsClient = new BackupBucketClient(project.landscape.kubeconfig)
  const [
    backupEntries,
    backupBuckets
  ] = await Promise.all([
    backupEntryClient.list(),
    backupBucketsClient.list()
  ])
  return _.map(backupEntries, backupEntry => {
    const backupBucket = _.find(
      backupBuckets,
      backupBucket => backupBucket.metadata.name === _.get(backupEntry, 'spec.bucketName')
    )
    return toBackupEntryTreeNode(project, backupEntry, backupBucket)
  })
}

function toBackupEntryTreeNode (project, backupEntry, backupBucket) {
  const name = _.get(backupEntry, 'metadata.name')
  return {
    nodeType: nodeType.NODE_TYPE_BACKUP_ENTRY,
    kindPlural: 'backupentries',
    name,
    project,
    bucket: _.get(backupEntry, 'spec.bucketName'),
    seed: _.get(backupEntry, 'spec.seedName'),
    providerType: _.get(backupBucket, 'spec.provider.type'),
  }
}

function backupEntryTooltip (element) {
  const list = [
    `BackupEntry: ${element.name}`,
    `Seed: ${element.seed}`,
    `Bucket: ${element.bucket}`,
  ]
  return list.join('\n')
}

async function seeds ({ parent: landscape }) {
  const seedClient = new SeedClient(landscape.kubeconfig)
  const seeds = await seedClient.list()
  return _.map(seeds, seed => {
    return toSeedTreeNode(landscape, seed)
  })
}

function toSeedTreeNode (landscape, seed) {
  const name = _.get(seed, 'metadata.name')
  return {
    nodeType: nodeType.NODE_TYPE_SEED,
    kindPlural: GKVEnum.SEEDS,
    name,
    landscape,
    kubeconfigSecretName: _.get(seed, 'spec.secretRef.name'),
    kubeconfigSecretNamespace: _.get(seed, 'spec.secretRef.namespace'),
    providerType: _.get(seed, 'spec.provider.type'),
    region: _.get(seed, 'spec.provider.region', ''),
    ingressDomain: _.get(seed, 'spec.dns.ingressDomain', ''),
    minVolumeSize: _.get(seed, 'spec.volume.minimumSize')
  }
}

function seedTooltip (element) {
  const list = [
    `Seed: ${element.name}`,
    `Provider: ${element.providerType}/${element.region}`,
    `Ingress Domain: ${element.ingressDomain}`,
    `Min Volume Size: ${element.minVolumeSize}`
  ]
  return list.join('\n')
}

function infraIcon (providerType) {
  const color = iconColor()
  let logo
  switch (providerType) {
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
    case 'vsphere':
      logo = `vsphere-${color}.svg`
      break
    case 'metal':
      logo = `metal-${color}.svg`
      break
    default:
      logo = `unknown-${color}.svg`
  }
  return vscode.Uri.file(path.join(__dirname, '..', 'assets', logo))
}

function settingsIcon () {
  const logo = `settings-${iconColor()}.svg`
  return vscode.Uri.file(path.join(__dirname, '..', 'assets', logo))
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
    case nodeType.NODE_TYPE_BACKUP_BUCKET:
      return `backup-${color}.svg`
    case nodeType.NODE_TYPE_BACKUP_ENTRY:
        return `backup-${color}.svg`
    default:
      return undefined
  }
}
