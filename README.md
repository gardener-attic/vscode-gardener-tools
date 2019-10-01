# Gardener Tools for VSCode

<img src="https://user-images.githubusercontent.com/5526658/65957954-7bf8dd80-e44e-11e9-9ca5-0d419a7c2716.png" width="180"/>

This `Visual Studio Code Kubernetes Tools` extension allows you to work with your gardener projects, shoots, plants and seeds.

<img src="https://user-images.githubusercontent.com/5526658/60663851-a8f22000-9e60-11e9-99e0-11a6a4313fb4.png" alt="VScode Gardener Tools Screenshot" width="600"/>

## Features

- List gardener projects
- List shoot clusters
- List plant clusters
- List backup infrastructure resources
- List backup bucket resources
- List backup entry resources
- List seed clusters
- Right click on landscape, shoot, plant or seed cluster to `Save Kubeconfig` / `Merge into Kubeconfig`
- Right click landscape or shoot to `Show In Dashboard`
- Right click on landscape to `Create Project` in gardener dashboard
- Right click on shoots list to `Create Shoot` in gardener dashboard
- [Gardenctl](https://github.com/gardener/gardenctl) integration
  - Right click on shoot or seed to get a `Shell` to a node
  - Right click on landscape, project, shoot or seed to `Target` with gardenctl

## Requirements
- You have installed the [Kubernetes Tools](https://marketplace.visualstudio.com/items?itemName=ms-kubernetes-tools.vscode-kubernetes-tools) extension from the marketplace
- [Gardenctl](https://github.com/gardener/gardenctl#installation) for `Shell` or `Target` command
- Kubeconfig to (virtual) garden cluster

## Install from VSIX

* Download .vsix file from latest [release](https://github.com/gardener/vscode-gardener-tools/releases) asset
* In VSCode, open the [command palette](https://code.visualstudio.com/docs/getstarted/tips-and-tricks#_command-palette): `View` -> `Command Palette...` -> type in `Extensions: Install from VSIX...`
* Choose .vsix file downloaded in first step

## Extension Settings

This extension contributes the following settings:

* `vscode-gardener-tools.vscode-light-theme`: should match your configured theme style. Default: true
* `vscode-gardener-tools.landscapes`: Required configuration for garden landscapes
* `vscode-gardener-tools.landscapes[].name`: Name of the garden cluster
* `vscode-gardener-tools.landscapes[].gardenName`: Optional name of the corresponding (gardenctl) garden. Default: Name of the landscape
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
          "gardenName": "virtual-dev",
          "kubeconfigPath": "/kubeconfigpath/cluster-dev-virtual-garden/kubeconfig.yaml",
          "dashboardUrl": "https://dashboard.garden.dev.example.com",
          "projects": ["garden", "myproject"]
        },
        {
          "name": "landscape-canary",
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
