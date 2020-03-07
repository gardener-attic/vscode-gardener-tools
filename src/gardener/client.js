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
const tmp = require('tmp')
const fs = require('fs')
const yaml = require('js-yaml')

const { configForLandscape, canI } = require('./utils')
const { getUseWsl, convertWindowsToWSL } = require('./vscodeUtils')

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
  constructor (kubeconfig, landscapeName, permissions) {
    const namespace = undefined // Project is a cluster scoped resource
    super(kubeconfig, namespace, GKVEnum.PROJECTS)
    this.landscapeName = landscapeName
    this.permissions = permissions
  }

  async list () {
    const config = configForLandscape(this.landscapeName)
    let projectNames = _.get(config, 'projects')
    if (_.isEmpty(projectNames)) {
      if (canI(this.permissions, 'list', 'core.gardener.cloud', 'projects')) {
        return super.list()
      }

      projectNames = _
        .chain(this.permissions)
        .get('resourceRules')
        .filter(({ apiGroups }) => _.includes(apiGroups, 'core.gardener.cloud'))
        .filter(({ resources }) => _.includes(resources, 'projects'))
        .flatMap('resourceNames')
        .compact()
        .uniq()
        .sort()
        .value()
    }

    const promises = _.map(projectNames, projectName =>
      this.cmd(`get project ${projectName} -o json --kubeconfig ${this.kubeconfig}`).catch(err => {
        console.log(err)
      })
    )
    let projects = await Promise.all(promises)
    projects = _.compact(projects)
    return projects
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

class SelfSubjectRulesReviewClient extends Kubectl {
  constructor (kubeconfig) {
    const namespace = undefined
    super(kubeconfig, namespace)
  }

  async getPermissions (namespace) {
    const tmpobj = tmp.fileSync()
    const body = {
      kind: 'SelfSubjectRulesReview',
      apiVersion: 'authorization.k8s.io/v1',
      metadata: {
        name: 'vscode-gardener'
      },
      spec: {
        namespace
      }
    }
    const fileContent = yaml.safeDump(body)
    fs.writeFileSync(tmpobj.name, fileContent)

    let fileName = tmpobj.name
    if (getUseWsl()) {
        fileName = convertWindowsToWSL(fileName)
    }

    const { status: res } = await this.cmd(`create -f ${fileName} -ojson --kubeconfig ${this.kubeconfig}`)
    tmpobj.removeCallback()

    return res
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
  SelfSubjectRulesReviewClient,
  NodeClient,
  GKVEnum
}
