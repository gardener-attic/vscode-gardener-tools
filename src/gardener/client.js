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

const k8s = require('vscode-kubernetes-tools-api')
const _ = require('lodash')

const { configForLandscape } = require('./utils')

const GKVEnum = {
  SHOOTS: 'shoots.v1beta1.core.gardener.cloud',
  SEEDS: 'seeds.v1beta1.core.gardener.cloud',
  PLANTS: 'plants.v1beta1.core.gardener.cloud',
  PROJECTS: 'projects.v1beta1.core.gardener.cloud',
  BACKUPBUCKETS: 'backupbuckets.v1beta1.core.gardener.cloud',
  BACKUPENTRIES: 'backupentries.v1beta1.core.gardener.cloud'
}

class Kubectl {
  constructor (kubeconfig, namespace) {
    this.kubeconfig = kubeconfig
    this.namespace = namespace
  }

  async cmd (command, parseFormat = 'json') {
    const kubectl = await k8s.extension.kubectl.v1
    if (!kubectl.available) {
      throw new Error('kubectl not available')
    }

    const { code, stderr, stdout } = await kubectl.api.invokeCommand(command)
    if (code !== 0) {
      throw new Error(stderr)
    }
    switch (parseFormat) {
      case 'json':
        return JSON.parse(stdout)
      case 'raw':
        return stdout
      default:
        throw new Error(`unknown outputForm ${parseFormat}`)
    }
  }
}

class Client extends Kubectl {
  constructor (kubeconfig, namespace, kindPlural) {
    super(kubeconfig, namespace)
    this.kindPlural = kindPlural
  }

  namespaceSelector () {
    if (this.namespace) {
      return `-n ${this.namespace}`
    }
    return ''
  }

  async list () {
    const { items } = await this.cmd(
      `get ${this.kindPlural} ${this.namespaceSelector()} -o json --kubeconfig ${this.kubeconfig}`
    )
    return items
  }

  async get (name, outputFormat = 'json') {
    return this.cmd(
      `get ${this.kindPlural}/${name} -n ${this.namespace} -o ${outputFormat} --kubeconfig ${this.kubeconfig}`
    )
  }
}

class ProjectClient extends Client {
  constructor (kubeconfig, landscapeName) {
    const namespace = undefined // Project is a cluster scoped resource
    super(kubeconfig, namespace, GKVEnum.PROJECTS)
    this.landscapeName = landscapeName
  }

  async list () {
    const config = configForLandscape(this.landscapeName)
    const projectNames = _.get(config, 'projects')
    if (!_.isEmpty(projectNames)) {
      const promises = _.map(projectNames, projectName =>
        this.cmd(`get project ${projectName} -o json --kubeconfig ${this.kubeconfig}`).catch(err => {
          console.log(err)
        })
      )
      let projects = await Promise.all(promises)
      projects = _.filter(projects, project => project !== undefined)
      return projects
    }

    return super.list()
  }
}

class ShootClient extends Client {
  constructor (kubeconfig, namespace) {
    super(kubeconfig, namespace, GKVEnum.SHOOTS)
  }
}

class PlantClient extends Client {
  constructor (kubeconfig, namespace) {
    super(kubeconfig, namespace, GKVEnum.PLANTS)
  }
}


class BackupBucketClient extends Client {
  constructor (kubeconfig) {
    const namespace = undefined // BackupBucket is a cluster scoped resource
    super(kubeconfig, namespace, GKVEnum.BACKUPBUCKETS)
  }
}
class BackupEntryClient extends Client {
  constructor (kubeconfig, namespace) {
    super(kubeconfig, namespace, GKVEnum.BACKUPENTRIES)
  }
}

class SeedClient extends Client {
  constructor (kubeconfig) {
    const namespace = undefined // CloudProfile is a cluster scoped resource
    super(kubeconfig, namespace, GKVEnum.SEEDS)
  }
}

class SecretClient extends Client {
  constructor (kubeconfig, namespace) {
    super(kubeconfig, namespace, 'secrets')
  }
}

class NodeClient extends Client {
  constructor (kubeconfig) {
    const namespace = undefined // Nodes is a cluster scoped resource
    super(kubeconfig, namespace, 'nodes')
  }
}

class SelfSubjectAccessReviewClient extends Kubectl {
  constructor (kubeconfig) {
    const namespace = undefined
    super(kubeconfig, namespace)
  }

  async canI (verb, kindPlural) {
    const res = _.trim(
      await this.cmd(`auth can-i ${verb} ${kindPlural} --kubeconfig ${this.kubeconfig}`, 'raw').catch(err => {
        console.log(err)
      })
    )
    return res === 'yes'
  }
}

module.exports = {
  ProjectClient,
  ShootClient,
  PlantClient,
  BackupBucketClient,
  BackupEntryClient,
  SeedClient,
  SecretClient,
  SelfSubjectAccessReviewClient,
  NodeClient,
  GKVEnum
}
