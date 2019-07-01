# Gardener Tools for VSCode

This vs-code extension allows you to work with your gardener projects, shoots, plants and seeds.

## Features

- List gardener projects
- List shoot clusters
- List plant clusters
- List seed clusters
- Save kubeconfig / merge into kubeconfig of landscape, shoot, plant and seed cluster
- Show In Dashboard

## Requirements

- Kubeconfig to (virtual) garden cluster

## Extension Settings

This extension contributes the following settings:

* `vscode-gardener-tools.vscode-light-theme`: should match your configured theme style. Default: true
* `vscode-gardener-tools.landscapes`: Required configuration for garden landscapes
* `vscode-gardener-tools.landscapes[].name`: Name of the garden cluster
* `vscode-gardener-tools.landscapes[].kubeconfigPath`: Path to the kubeconfig of the garden cluster
* `vscode-gardener-tools.landscapes[].dashboardUrl`: Gardener dashboard URL,
* `vscode-gardener-tools.landscapes[].projects`: Optional list of projects (names) to be shown. However, you should specify this list if you do not have operator rights on the garden cluster or if you want to see only those projects.

Example config settings.json:
```js
    "vscode-gardener-tools": {
      "vscode-light-theme": false,
      "landscapes": [
        {
          "name": "landscape-dev",
          "kubeconfigPath": "/kubeconfigpath/cluster-dev-virtual-garden/kubeconfig.yaml",
          "dashboardUrl": "https://dashboard.garden.dev.example.com",
          "projects": ["garden", "myproject"]
        },
        {
          "name": "landscape-peter",
          "kubeconfigPath": "/kubeconfigpath/cluster-canary-virtual-garden/kubeconfig.yaml",
          "dashboardUrl": "https://dashboard.garden.canary.example.com"
        },
      ]
    }
```

To change the `Gardener Kubernetes Tools` settings:
* On Windows/Linux - `File` > `Preferences` > `Settings`
* On macOS - `Code` > `Preferences` > `Settings`

Then search for `Gardener Kubernetes Tools` or navigate to `User Settings` > `Extensions` > `Gardener Kubernetes Tools`
