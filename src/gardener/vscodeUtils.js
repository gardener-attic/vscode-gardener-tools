// forked from https://github.com/Azure/vscode-kubernetes-tools

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

'use strict'

const vscode = require('vscode')
const path = require('path')
const shellProxy = require('shelljs-exec-proxy')
const sysfs = require('fs')
const _ = require('lodash')

const EXTENSION_CONFIG_KEY = 'vs-kubernetes' // TODO use own property config key

const WINDOWS = 'win32'

const Platform = {
  Windows: 'windows',
  MacOS: 'mac',
  Linux: 'linux',
  Unsupported: 'unsupported' // shouldn't happen!
}

async function runAsTerminal (context, command, terminalName) {
  if (await checkPresent(context, CheckPresentMessageMode.Command)) {
    let execPath = await getPath(context.binName)
    const cmd = command
    if (getUseWsl()) {
      cmd.unshift(execPath)
      // Note VS Code is picky here. It requires the '.exe' to work
      execPath = 'wsl.exe'
    }
    const term = createTerminal(terminalName, execPath, cmd)
    term.show()
  }
}

function createTerminal (name, shellPath, shellArgs) {
  const terminalOptions = {
    name: name,
    shellPath: shellPath,
    shellArgs: shellArgs,
    env: shellEnvironment(process.env)
  }
  return vscode.window.createTerminal(terminalOptions)
}

function checkPresent (context, errorMessageMode) {
  if (context.binFound || context.pathfinder) {
    return true
  }

  return checkForBinInternal(context, errorMessageMode)
}

async function checkForBinInternal (context, errorMessageMode) {
  const binName = context.binName
  const bin = getToolPath(binName)

  const contextMessage = getCheckContextMessage(errorMessageMode)
  const inferFailedMessage = `Could not find "${binName}" binary.${contextMessage}`
  const configuredFileMissingMessage = `${bin} does not exist! ${contextMessage}`

  return await checkForBinary(
    context,
    bin,
    binName,
    inferFailedMessage,
    configuredFileMissingMessage,
    errorMessageMode !== CheckPresentMessageMode.Silent
  )
}

async function checkForBinary (context, bin, binName, inferFailedMessage, configuredFileMissingMessage, alertOnFail) {
  if (!bin) {
    const fb = await findBinary(binName)

    if (fb.err || fb.output.length === 0) {
      if (alertOnFail) {
        alertNoBin(binName, 'inferFailed', inferFailedMessage, context.installDependenciesCallback)
      }
      return false
    }

    context.binFound = true

    return true
  }

  if (!getUseWsl()) {
    context.binFound = sysfs.existsSync(bin)
  } else {
    const sr = getShell().ls(bin)
    context.binFound = !!sr && sr.code === 0
  }
  if (context.binFound) {
    context.binPath = bin
  } else {
    if (alertOnFail) {
      alertNoBin(binName, 'configuredFileMissing', configuredFileMissingMessage, context.installDependenciesCallback)
    }
  }

  return context.binFound
}

async function findBinary (binName) {
  let which = `which`

  if (isWindows()) {
    which = 'where.exe'
    binName = `${binName}.exe`
  }

  const execResult = getShell()[which](binName)
  if (!execResult) {
    return { err: 1, output: `${binName} not found` }
  } else if (execResult.code) {
    return { err: execResult.code, output: execResult.stderr }
  }

  return { err: null, output: execResult.stdout }
}

function getShell () {
  const aShell = shellProxy
  if (!aShell.config.execPath) {
    aShell.config.execPath = process.execPath
  }
  if (getUseWsl()) {
    return aShell.wsl
  }
  return aShell
}

function alertNoBin (binName, failureReason, message, installDependencies) {
  switch (failureReason) {
    case 'inferFailed':
      showErrorMessage(message, 'Install dependencies', 'Learn more').then(str => {
        switch (str) {
          case 'Learn more':
            showInformationMessage(
              `Add ${binName} directory to path, or set "vs-kubernetes.${binName}-path" config to ${binName} binary.`
            )
            break
          case 'Install dependencies':
            installDependencies()
            break
        }
      })
      break
    case 'configuredFileMissing':
      showErrorMessage(message, 'Install dependencies').then(str => {
        if (str === 'Install dependencies') {
          installDependencies()
        }
      })
      break
  }
}

function showErrorMessage (message, ...items) {
  return vscode.window.showErrorMessage(message, ...items)
}

function showInformationMessage (message, ...items) {
  return vscode.window.showInformationMessage(message, ...items)
}

const CheckPresentMessageMode = {
  Command: 'command',
  Activation: 'activation',
  Silent: 'silent'
}

function getCheckContextMessage (errorMessageMode) {
  if (errorMessageMode === CheckPresentMessageMode.Activation) {
    return ' Kubernetes commands other than configuration will not function correctly.'
  } else if (errorMessageMode === CheckPresentMessageMode.Command) {
    return ' Cannot execute command.'
  }
  return ''
}

function shellEnvironment (baseEnvironment) {
  const env = Object.assign({}, baseEnvironment)
  const pathVariable = pathVariableName(env)
  for (const tool of [ 'gardenctl' ]) {
    const toolPath = getToolPath(tool)
    if (toolPath) {
      const toolDirectory = path.dirname(toolPath)
      const currentPath = env[pathVariable]
      env[pathVariable] = toolDirectory + (currentPath ? `${pathEntrySeparator()}${currentPath}` : '')
    }
  }
  return env
}

function pathEntrySeparator () {
  return isWindows() ? '' : ':'
}

function pathVariableName (env) {
  if (isWindows()) {
    for (const v of Object.keys(env)) {
      if (v.toLowerCase() === 'path') {
        return v
      }
    }
  }
  return 'PATH'
}

function isWindows () {
  return process.platform === WINDOWS && !getUseWsl()
}

// Use WSL on Windows
const USE_WSL_KEY = 'use-wsl'

function getUseWsl () {
  return vscode.workspace.getConfiguration(EXTENSION_CONFIG_KEY)[USE_WSL_KEY]
}

function convertWindowsToWSL (filePath) {
  const drive = filePath[0].toLowerCase()
  const path = filePath.substring(2).replace(/\\/g, '/')
  return `/mnt/${drive}/${path}`
}

function getToolPath (tool) {
  const baseKey = toolPathBaseKey(tool)
  return getPathSetting(baseKey)
}

function getPathSetting (baseKey) {
  const os = platform()
  const osOverridePath = getConfiguration(EXTENSION_CONFIG_KEY)[osOverrideKey(os, baseKey)]
  return osOverridePath || getConfiguration(EXTENSION_CONFIG_KEY)[baseKey]
}

function getConfiguration (key) {
  return vscode.workspace.getConfiguration(key)
}

function platform () {
  if (getUseWsl()) {
    return Platform.Linux
  }
  switch (process.platform) {
    case 'win32':
      return Platform.Windows
    case 'darwin':
      return Platform.MacOS
    case 'linux':
      return Platform.Linux
    default:
      return Platform.Unsupported
  }
}

function toolPathBaseKey (tool) {
  return `vs-kubernetes.${tool}-path` // TODO use own property
}

function osOverrideKey (os, baseKey) {
  const osKey = osKeyString(os)
  return osKey ? `${baseKey}.${osKey}` : baseKey // The 'else' clause should never happen so don't worry that this would result in double-checking a missing base key
}

function osKeyString (os) {
  switch (os) {
    case Platform.Windows:
      return 'windows'
    case Platform.MacOS:
      return 'mac'
    case Platform.Linux:
      return 'linux'
    default:
      return null
  }
}

async function getPath (binName) {
  const bin = await basePath(binName)
  return execPath(bin)
}

async function basePath (binName) {
  // if (context.pathfinder) {
  //     return await context.pathfinder()
  // }
  let bin = getToolPath(binName)
  if (!bin) {
    bin = binName
  }
  return bin
}

async function invokeInTerminal (context, command, pipeTo, terminal) {
  if (await checkPresent(context, CheckPresentMessageMode.Command)) {
    // You might be tempted to think we needed to add 'wsl' here if user is using wsl
    // but this runs in the context of a vanilla terminal, which is controlled by the
    // existing preference, so it's not necessary.
    // But a user does need to default VS code to use WSL in the settings.json
    const binCommand = `${context.binName} ${command}`
    const fullCommand = pipeTo ? `${binCommand} | ${pipeTo}` : binCommand
    terminal.sendText(fullCommand)
    terminal.show()
  }
}

async function invoke (context, shell, args) {
  return new Promise(async function (resolve, reject) {
    try {
      await toolInternal(context, shell, args, (code, stdout, stderr) => {
        if (code !== 0) {
          const errMessage = _.isEmpty(stderr) ? stdout : stderr
          reject(new Error(errMessage))
          return
        }
        resolve(stdout)
      })
    } catch (err) {
      reject(err)
    }
  })
}

async function toolInternal (context, shell, args, handler) {
  if (await checkPresent(context, CheckPresentMessageMode.Command)) {
    // const bin = await basePath(context.binName)
    // const cmd = `${bin} ${command}`
    // const sr = await exec(cmd)
    const sr = shell(...args)
    if (sr) {
      handler(sr.code, sr.stdout, sr.stderr)
    }
  }
}

function onDidCloseTerminal (listener) {
  return vscode.window.onDidCloseTerminal(listener)
}

function execPath (basePath) {
  let bin = basePath
  if (isWindows() && bin && !bin.endsWith('.exe')) {
    bin = bin + '.exe'
  }
  return bin
}

class GardenctlImpl {
  constructor (binFound = false) {
    this.context = {
      installDependenciesCallback: () => {}, // TODO
      pathfinder: undefined, // TODO
      binFound,
      binPath: 'gardenctl',
      binName: 'gardenctl'
    }
  }

  checkPresent (errorMessageMode) {
    return checkPresent(this.context, errorMessageMode)
  }
  getShell () {
    return getShell()[this.context.binName]
  }
  async invoke (shell, ...args) {
    return invoke(this.context, shell, args)
  }
  invokeInSharedTerminal (command) {
    const terminal = this.getSharedTerminal()
    return invokeInTerminal(this.context, command, undefined, terminal)
  }
  runAsTerminal (command, terminalName) {
    return runAsTerminal(this.context, command, terminalName)
  }
  getSharedTerminal () {
    if (!this.sharedTerminal) {
      this.sharedTerminal = createTerminal('gardenctl')
      const disposable = onDidCloseTerminal(terminal => {
        if (terminal === this.sharedTerminal) {
          this.sharedTerminal = null
          disposable.dispose()
        }
      })
    }
    return this.sharedTerminal
  }
}

module.exports = {
  GardenctlImpl,
  CheckPresentMessageMode,
  convertWindowsToWSL,
  getUseWsl
}
