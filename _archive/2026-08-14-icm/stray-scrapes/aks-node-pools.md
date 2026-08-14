Table of contents Exit editor mode

Ask LearnAsk Learn

Reading modeTable of contents[Read in English](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm)Add to CollectionsAdd to plan[Edit](https://github.com/MicrosoftDocs/azure-aks-docs/blob/main/articles/aks/create-node-pools.md)

* * *

Copy MarkdownPrint

* * *

Note

Access to this page requires authorization. You can try [signing in](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#) or changing directories.


Access to this page requires authorization. You can try changing directories.


# Create node pools for a cluster in Azure Kubernetes Service (AKS)

Feedback

Summarize this article for me


Choose a deployment method


Azure CLIARM template

This article shows you how to create one or more node pools in an AKS cluster.

Note

This feature enables more control over creating and managing multiple node pools and requires separate commands for _create/update/delete_ (CRUD) operations. Previously, cluster operations through [`az aks create`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-create) or [`az aks update`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-update) used the managedCluster API and were the only options to change your control plane and a single node pool. This feature exposes a separate operation set for agent pools through the agentPool API and requires use of the [`az aks nodepool`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool) command set to execute operations on an individual node pool.

Important

Starting on **November 30, 2025**, Azure Kubernetes Service (AKS) no longer supports or provides security updates for Azure Linux 2.0. The Azure Linux 2.0 node image is frozen at the [202512.06.0 release](https://raw.githubusercontent.com/Azure/AgentBaker/main/vhdbuilder/release-notes/AKSCBLMarinerV2/gen2/202512.06.0.txt). Beginning on **March 31, 2026**, node images will be removed, and you'll be unable to scale your node pools. Migrate to a supported Azure Linux version by [upgrading your node pools](https://learn.microsoft.com/en-us/azure/aks/upgrade-aks-cluster) to a supported Kubernetes version or migrating to [osSku AzureLinux3](https://learn.microsoft.com/en-us/azure/aks/upgrade-os-version). For more information, see the [Retirement GitHub issue](https://github.com/Azure/AKS/issues/4988) and the [Azure Updates retirement announcement](https://azure.microsoft.com/updates?id=500645). To stay informed on announcements and updates, follow the [AKS release notes](https://github.com/Azure/AKS/releases).

[Section titled: Prerequisites](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#prerequisites)

## Prerequisites

- You need Azure CLI version 2.2.0 or later installed and configured. Run `az --version` to find the version. If you need to install or upgrade, see [Install Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli).

- To deploy an ARM template, you need write access on the resources you're deploying and access to all operations on the `Microsoft.Resources/deployments` resource type. For example, to deploy a virtual machine (VM), you need `Microsoft.Compute/virtualMachines/write` and `Microsoft.Resources/deployments/*` permissions. For a list of roles and permissions, see [Azure built-in roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles).

- Review the following requirements for each parameter:

  - `osTYPE`: The operating system type. The default is Linux.
  - `osSKU`: Specifies the OS SKU used by the agent pool.
  - `count`: Number of agents (VMs) to host docker containers. Allowed values must be in the range of 0 to 1000 (inclusive) for user pools and in the range of 1 to 1000 (inclusive) for system pools. The default value is 1.
- After you deploy the cluster using an ARM template, you can use Azure CLI or Azure PowerShell to connect to the cluster and deploy the sample application.


[Section titled: Limitations](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#limitations)

## Limitations

The following limitations apply when you create AKS clusters that support multiple node pools:

- You can delete the system node pool if you have another system node pool to take its place in the AKS cluster. Otherwise, you can't delete the system node pool.

- System pools must contain at least one node. User node pools can contain zero or more nodes.

- **If you create a cluster with a single node pool, the OS type must be `Linux`**. The OS SKU can be any Linux variation such as `Ubuntu` or `AzureLinux`. You can't create a cluster with a single Windows node pool. If you want to run Windows containers, you must [add a Windows node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#add-a-windows-server-node-pool) to the cluster after creating it with a Linux system node pool.

- The AKS cluster must use the Standard SKU load balancer to use multiple node pools. This feature isn't supported with Basic SKU load balancers.

- The AKS cluster must use Virtual Machine Scale Sets for the nodes.

- The name of a node pool can only contain lowercase alphanumeric characters and must begin with a lowercase letter.

  - For Linux node pools, the length must be between 1-12 characters.
  - For Windows node pools, the length must be between 1-6 characters.
- All node pools must reside in the same virtual network.

- You can't change the virtual machine (VM) size of a node pool after you create it.

- When you create multiple node pools at cluster creation time, the Kubernetes versions for the node pools must match the version set for the control plane. You can make updates after provisioning the cluster using per node pool operations.


[Section titled: Create specialized node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-specialized-node-pools)

## Create specialized node pools

To learn how to create specialized node pools, see the following articles:

- [Add an Azure Spot node pool to an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool)
- [Add a Virtual Machines node pool to an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/virtual-machines-node-pools)
- [Add a dedicated system node pool to an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/use-system-pools#add-a-dedicated-system-node-pool-to-an-existing-aks-cluster)
- [Enabled Federal Information Processing Standards (FIPS) on an AKS node pool](https://learn.microsoft.com/en-us/azure/aks/enable-fips-nodes)
- [Add a node pool with a Confidential Virtual Machine (CVM) on an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/use-cvm)
- [Create node pools with unique subnets in AKS](https://learn.microsoft.com/en-us/azure/aks/node-pool-unique-subnet)
- [Add a generation 2 VM node pool to an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/generation-2-vms)
- [Add a node pool with Artifact Streaming to an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/artifact-streaming)
- [Add Windows Server node pools with `containerd` to an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/windows-containerd)

[Section titled: Set environment variables](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#set-environment-variables)

## Set environment variables

- Set the following environment variables in your shell to simplify the commands in this article. You can change the values to your preferred names.


Bash


Copy




```bash
export RESOURCE_GROUP_NAME="my-aks-rg"
export LOCATION="eastus"
export CLUSTER_NAME="my-aks-cluster"
export NODE_POOL_NAME="mynodepool"
```


[Section titled: Create a resource group](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-a-resource-group)

## Create a resource group

- Create an Azure resource group using the [`az group create`](https://learn.microsoft.com/en-us/cli/azure/group#az-group-create) command.


Azure CLI


CopyOpen Cloud Shell




```azurecli
az group create --name $RESOURCE_GROUP_NAME --location $LOCATION
```


[Section titled: Create an AKS cluster with a single node pool using the Azure CLI](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-an-aks-cluster-with-a-single-node-pool-using-the-azure-cli)

## Create an AKS cluster with a single node pool using the Azure CLI

If you want only one node pool in your AKS cluster, you can schedule application pods on system node pools. If you run a single system node pool for your AKS cluster in a production environment, we recommend you use at least three nodes for the node pool. If one node goes down, the redundancy is compromised. You can mitigate this risk by having more system node pool nodes.

- [Create an AKS cluster with a single Ubuntu node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_1_ubuntu)
- [Create an AKS cluster with a single Azure Linux node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_1_azure-linux)
- [Create an AKS cluster with a single Azure Linux with OS Guard for AKS (preview) node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_1_os-guard)
- [Create an AKS cluster with a single Flatcar Container Linux for AKS (preview) node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_1_flatcar)

1. Create a cluster with a single Ubuntu node pool using the [`az aks create`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-create) command. This step specifies two nodes in the single node pool.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks create \
       --resource-group $RESOURCE_GROUP_NAME \
       --name $CLUSTER_NAME \
       --vm-set-type VirtualMachineScaleSets \
       --node-count 2 \
       --os-sku Ubuntu \
       --location $LOCATION \
       --load-balancer-sku standard \
       --generate-ssh-keys
```


It takes a few minutes to create the cluster.

2. When the cluster is ready, get the cluster credentials using the [`az aks get-credentials`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-get-credentials) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks get-credentials --resource-group $RESOURCE_GROUP_NAME --name $CLUSTER_NAME
```


1. Create a cluster with a single Azure Linux node pool using the [`az aks create`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-create) command. This step specifies two nodes in the single node pool.

For more information about Azure Linux, see [Azure Linux on AKS](https://learn.microsoft.com/en-us/azure/aks/use-azure-linux).


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks create \
       --resource-group $RESOURCE_GROUP_NAME \
       --name $CLUSTER_NAME \
       --vm-set-type VirtualMachineScaleSets \
       --node-count 2 \
       --os-sku AzureLinux \
       --location $LOCATION \
       --load-balancer-sku standard \
       --generate-ssh-keys
```


It takes a few minutes to create the cluster.

2. When the cluster is ready, get the cluster credentials using the [`az aks get-credentials`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-get-credentials) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks get-credentials --resource-group $RESOURCE_GROUP_NAME --name $CLUSTER_NAME
```


[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension)

#### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AzureLinuxOSGuardPreview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-azurelinuxosguardpreview-feature-flag)

#### Register the `AzureLinuxOSGuardPreview` feature flag

1. Register the `AzureLinuxOSGuardPreview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AzureLinuxOSGuardPreview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AzureLinuxOSGuardPreview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Azure Linux with OS Guard for AKS cluster](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-azure-linux-with-os-guard-for-aks-cluster)

#### Create the Azure Linux with OS Guard for AKS cluster

1. Create a cluster with a single Azure Linux with OS Guard for AKS (preview) node pool using the [`az aks create`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-create) command. This step specifies two nodes in the single node pool.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks create \
       --resource-group $RESOURCE_GROUP_NAME \
       --name $CLUSTER_NAME \
       --vm-set-type VirtualMachineScaleSets \
       --node-count 2 \
       --os-sku AzureLinuxOSGuard \
       --node-osdisk-type Managed \
       --enable-fips-image \
       --enable-secure-boot \
       --enable-vtpm
       --location $LOCATION \
       --load-balancer-sku standard \
       --generate-ssh-keys
```


It takes a few minutes to create the cluster.

2. When the cluster is ready, get the cluster credentials using the [`az aks get-credentials`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-get-credentials) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks get-credentials --resource-group $RESOURCE_GROUP_NAME --name $CLUSTER_NAME
```


[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-1)

#### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command. **Flatcar Container Linux requires a minimum of 18.0.0b42**.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AKSFlatcarPreview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-aksflatcarpreview-feature-flag)

#### Register the `AKSFlatcarPreview` feature flag

1. Register the `AKSFlatcarPreview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AKSFlatcarPreview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AKSFlatcarPreview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Flatcar Container Linux for AKS cluster](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-flatcar-container-linux-for-aks-cluster)

#### Create the Flatcar Container Linux for AKS cluster

1. Create a cluster with a single Flatcar Container Linux for AKS (preview) node pool using the [`az aks create`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-create) command. This step specifies two nodes in the single node pool.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks create \
       --resource-group $RESOURCE_GROUP_NAME \
       --name $CLUSTER_NAME \
       --vm-set-type VirtualMachineScaleSets \
       --node-count 2 \
       --os-sku flatcar \
       --location $LOCATION \
       --load-balancer-sku standard \
       --generate-ssh-keys
```


It takes a few minutes to create the cluster.

2. When the cluster is ready, get the cluster credentials using the [`az aks get-credentials`](https://learn.microsoft.com/en-us/cli/azure/aks#az-aks-get-credentials) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks get-credentials --resource-group $RESOURCE_GROUP_NAME --name $CLUSTER_NAME
```


[Section titled: Add a second node pool using the Azure CLI](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#add-a-second-node-pool-using-the-azure-cli)

## Add a second node pool using the Azure CLI

The cluster created in the [previous section](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-an-aks-cluster-with-a-single-node-pool-using-the-azure-cli) has a single node pool. In this section, we add a second node pool to the cluster. This second node pool can have an OS type of `Linux` with an OS SKU of `Ubuntu` or `AzureLinux`, or an OS type of `Windows`.

Note

If you want to add a node pool that uses **Ephemeral OS disks** to your AKS cluster, you can set the `--node-osdisk-type` flag to `Ephemeral` when running the `az aks nodepool add` command.

With Ephemeral OS, you can deploy VMs and instance images up to the size of the VM cache. The default node OS disk configuration in AKS uses 128 GB, which means that you need a VM size that has a cache larger than 128 GB. The default `Standard_DS2_v2` has a cache size of 86 GB, which isn't large enough. The `Standard_DS3_v2` VM SKU has a cache size of 172 GB, which is large enough. You can also reduce the default size of the OS disk using `--node-osdisk-size`, but keep in mind the minimum size for AKS images is 30 GB.

If you want to create node pools with **network-attached OS disks**, you can set the `--node-osdisk-type` flag to `Managed` when running the `az aks nodepool add` command.

[Section titled: Add a Linux node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#add-a-linux-node-pool)

### Add a Linux node pool

- [Add an Ubuntu node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_2_ubuntu)
- [Add an Azure Linux node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_2_azure-linux)
- [Add an Azure Linux with OS Guard for AKS (preview) node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_2_os-guard)
- [Add a Flatcar Container Linux for AKS (preview) node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_2_flatcar)

- Create a new node pool using the [`az aks nodepool add`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-add) command. The following example creates a `Linux` node pool with the `Ubuntu` OS SKU that runs _three_ nodes. If you don't specify an OS SKU, AKS defaults to `Ubuntu`.


Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks nodepool add \
      --resource-group $RESOURCE_GROUP_NAME \
      --cluster-name $CLUSTER_NAME \
      --name $NODE_POOL_NAME \
      --node-vm-size Standard_DS2_v2 \
      --os-type Linux \
      --os-sku Ubuntu \
      --node-count 3
```


It takes a few minutes to create the node pool.


- Create a new node pool using the [`az aks nodepool add`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-add) command. The following example creates a `Linux` node pool with the `Azure Linux` OS SKU that runs _three_ nodes. If you don't specify an OS SKU, AKS defaults to `Ubuntu`.

For more information about Azure Linux, see [Azure Linux on AKS](https://learn.microsoft.com/en-us/azure/aks/use-azure-linux).


Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks nodepool add \
      --resource-group $RESOURCE_GROUP_NAME \
      --cluster-name $CLUSTER_NAME \
      --name $NODE_POOL_NAME \
      --node-vm-size Standard_DS2_v2 \
      --os-type Linux \
      --os-sku AzureLinux \
      --node-count 3
```


It takes a few minutes to create the node pool.


[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-2)

##### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AzureLinuxOSGuardPreview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-azurelinuxosguardpreview-feature-flag-1)

##### Register the `AzureLinuxOSGuardPreview` feature flag

1. Register the `AzureLinuxOSGuardPreview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AzureLinuxOSGuardPreview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AzureLinuxOSGuardPreview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Azure Linux with OS Guard for AKS node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-azure-linux-with-os-guard-for-aks-node-pool)

##### Create the Azure Linux with OS Guard for AKS node pool

- Create a new node pool using the [`az aks nodepool add`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-add) command. The following example creates a `Linux` node pool with the `Azure Linux with OS Guard` OS SKU that runs _three_ nodes. If you don't specify an OS SKU, AKS defaults to `Ubuntu`.


Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks nodepool add \
      --resource-group $RESOURCE_GROUP_NAME \
      --cluster-name $CLUSTER_NAME \
      --name $NODE_POOL_NAME \
      --node-vm-size Standard_DS2_v2 \
      --os-type Linux \
     --os-sku AzureLinuxOSGuard \
     --node-osdisk-type Managed \
     --enable-fips-image \
     --enable-secure-boot \
     --enable-vtpm \
     --node-count 3
```


It takes a few minutes to create the node pool.

For more information, see [Azure Linux with OS Guard for AKS](https://learn.microsoft.com/en-us/azure/aks/use-azure-linux-os-guard).


[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-3)

##### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command. **Flatcar Container Linux requires a minimum of 18.0.0b42**.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AKSFlatcarPreview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-aksflatcarpreview-feature-flag-1)

##### Register the `AKSFlatcarPreview` feature flag

1. Register the `AKSFlatcarPreview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AKSFlatcarPreview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AKSFlatcarPreview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Flatcar Container Linux for AKS node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-flatcar-container-linux-for-aks-node-pool)

##### Create the Flatcar Container Linux for AKS node pool

- Create a new node pool using the [`az aks nodepool add`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-add) command. The following example creates a `Linux` node pool with the `flatcar` OS SKU that runs _three_ nodes. If you don't specify an OS SKU, AKS defaults to `Ubuntu`.


Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks nodepool add \
      --resource-group $RESOURCE_GROUP_NAME \
      --cluster-name $CLUSTER_NAME \
      --name $NODE_POOL_NAME \
      --node-vm-size Standard_DS2_v2 \
      --os-type Linux \
      --os-sku flatcar \
      --node-count 3
```


It takes a few minutes to create the node pool.

For more information, see [Flatcar Container Linux for AKS](https://learn.microsoft.com/en-us/azure/aks/flatcar-container-linux-for-aks).


[Section titled: Add a Windows Server node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#add-a-windows-server-node-pool)

### Add a Windows Server node pool

- [Add a Windows Server 2025 (preview) node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_3_ws2025)
- [Add a Windows Server 2022 node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_3_ws2022)

[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-4)

##### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command. **Windows Server 2025 requires a minimum of 18.0.0b5**.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AksWindows2025Preview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-akswindows2025preview-feature-flag)

##### Register the `AksWindows2025Preview` feature flag

1. Register the `AksWindows2025Preview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AksWindows2025Preview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AksWindows2025Preview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Windows Server 2025 node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-windows-server-2025-node-pool)

##### Create the Windows Server 2025 node pool

- Create a new node pool using the [`az aks nodepool add`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-add) command. The following example creates a `Windows` node pool with the `Windows2025` OS SKU that runs _three_ nodes.

For more information about Windows OS, see [Windows best practices](https://learn.microsoft.com/en-us/azure/aks/windows-best-practices).


Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks nodepool add \
      --resource-group $RESOURCE_GROUP_NAME \
      --cluster-name $CLUSTER_NAME \
      --name $NODE_POOL_NAME \
      --node-vm-size Standard_DS2_v2 \
      --os-type Windows \
      --os-sku Windows2025 \
      --node-count 3
```


- Create a new node pool using the [`az aks nodepool add`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-add) command. The following example creates a `Windows` node pool with the `Windows2022` OS SKU that runs _three_ nodes.

For more information about Windows OS, see [Windows best practices](https://learn.microsoft.com/en-us/azure/aks/windows-best-practices).


Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks nodepool add \
      --resource-group $RESOURCE_GROUP_NAME \
      --cluster-name $CLUSTER_NAME \
      --name $NODE_POOL_NAME \
      --node-vm-size Standard_DS2_v2 \
      --os-type Windows \
      --os-sku Windows2022 \
      --node-count 3
```


[Section titled: Check the status of your node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#check-the-status-of-your-node-pools)

## Check the status of your node pools

- Check the status of your node pools using the [`az aks nodepool list`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-list) command and specify your resource group and cluster name.


Azure CLI


CopyOpen Cloud Shell




```azurecli
az aks nodepool list --resource-group $RESOURCE_GROUP_NAME --cluster-name $CLUSTER_NAME
```


[Section titled: Create an AKS cluster with a single node pool using an ARM template](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-an-aks-cluster-with-a-single-node-pool-using-an-arm-template)

## Create an AKS cluster with a single node pool using an ARM template

If you want only one node pool in your AKS cluster, you can schedule application pods on system node pools. If you run a single system node pool for your AKS cluster in a production environment, we recommend you use at least three nodes for the node pool. If one node goes down, the redundancy is compromised. You can mitigate this risk by having more system node pool nodes.

[Section titled: Create a Microsoft.ContainerService/managedClusters resource](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-a-microsoftcontainerservicemanagedclusters-resource)

### Create a `Microsoft.ContainerService/managedClusters` resource

- Create a `Microsoft.ContainerService/managedClusters` resource by adding [this JSON](https://learn.microsoft.com/en-us/azure/templates/microsoft.containerservice/managedclusters?pivots=deployment-language-arm-template) to your template.

- [Modify JSON to create a single Ubuntu node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_4_ubuntu-arm)
- [Modify JSON to create a single Azure Linux node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_4_azure-linux-arm)
- [Modify JSON to create a single Azure Linux with OS Guard for AKS (preview) node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_4_os-guard-arm)
- [Modify JSON to create a single Flatcar Container Linux for AKS (preview) node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_4_flatcar-arm)

- Create a single Ubuntu node pool in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "1",\
          "osSKU": "ubuntu",\
          "osType": "linux"\
       }\
       ],
}
```


- Create a single Azure Linux node pool in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "1",\
          "osSKU": "AzureLinux",\
          "osType": "linux"\
       }\
       ],
}
```


For more information about Azure Linux, see [Azure Linux on AKS](https://learn.microsoft.com/en-us/azure/aks/use-azure-linux).


[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-5)

#### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AzureLinuxOSGuardPreview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-azurelinuxosguardpreview-feature-flag-2)

#### Register the `AzureLinuxOSGuardPreview` feature flag

1. Register the `AzureLinuxOSGuardPreview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AzureLinuxOSGuardPreview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AzureLinuxOSGuardPreview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Azure Linux with OS Guard for AKS node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-azure-linux-with-os-guard-for-aks-node-pool-1)

#### Create the Azure Linux with OS Guard for AKS node pool

- Create a single Azure Linux with OS Guard for AKS node pool in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "1",\
          "osSKU": "AzureLinuxOSGuard",\
          "osType": "linux",\
          "osDiskType": "Managed",\
                      "enableFIPS": true,\
                      "securityProfile": {\
                          "enableSecureBoot": true,\
                          "enableVTPM": true\
                      },\
       }\
       ],
}
```


For more information, see [Azure Linux with OS Guard for AKS](https://learn.microsoft.com/en-us/azure/aks/use-azure-linux-os-guard).


[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-6)

#### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command. **Flatcar Container Linux requires a minimum of 18.0.0b42**.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AKSFlatcarPreview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-aksflatcarpreview-feature-flag-2)

#### Register the `AKSFlatcarPreview` feature flag

1. Register the `AKSFlatcarPreview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AKSFlatcarPreview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AKSFlatcarPreview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Flatcar Container Linux for AKS node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-flatcar-container-linux-for-aks-node-pool-1)

#### Create the Flatcar Container Linux for AKS node pool

- Create a single Flatcar Container Linux for AKS node pool in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "1",\
          "osSKU": "flatcar",\
          "osType": "linux"\
       }\
       ],
}
```


For more information, see [Flatcar Container Linux for AKS](https://learn.microsoft.com/en-us/azure/aks/flatcar-container-linux-for-aks).


[Section titled: Add a second node pool using an ARM template](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#add-a-second-node-pool-using-an-arm-template)

## Add a second node pool using an ARM template

The cluster created in the [previous section](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-an-aks-cluster-with-a-single-node-pool-using-an-arm-template) has a single node pool. In this section, we add a second node pool to the cluster. This second node pool can have an OS type of `Linux` with an OS SKU of `Ubuntu` or `AzureLinux`, or an OS type of `Windows`.

[Section titled: Add Linux node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#add-linux-node-pools)

### Add Linux node pools

- [Modify JSON to create multiple Ubuntu node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_5_ubuntu-arm)
- [Modify JSON to create multiple Azure Linux node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_5_azure-linux-arm)
- [Modify JSON to create multiple Azure Linux with OS Guard for AKS (preview) node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_5_os-guard-arm)
- [Modify JSON to create multiple Flatcar Container Linux for AKS (preview) node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_5_flatcar-arm)

- Create multiple Ubuntu node pools in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "3",\
          "osSKU": "ubuntu",\
          "osType": "linux"\
       }\
       ],
}
```


- Create multiple Azure Linux node pools in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "3",\
          "osSKU": "AzureLinux",\
          "osType": "linux"\
       }\
       ],
}
```


For more information about Azure Linux, see [Azure Linux on AKS](https://learn.microsoft.com/en-us/azure/aks/use-azure-linux).


[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-7)

##### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AzureLinuxOSGuardPreview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-azurelinuxosguardpreview-feature-flag-3)

##### Register the `AzureLinuxOSGuardPreview` feature flag

1. Register the `AzureLinuxOSGuardPreview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AzureLinuxOSGuardPreview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AzureLinuxOSGuardPreview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Azure Linux with OS Guard for AKS node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-azure-linux-with-os-guard-for-aks-node-pools)

##### Create the Azure Linux with OS Guard for AKS node pools

- Create multiple Azure Linux with OS Guard for AKS (preview) node pools in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "3",\
          "osSKU": "AzureLinuxOSGuard",\
          "osType": "linux",\
          "osDiskType": "Managed",\
          "enableFIPS": true,\
          "securityProfile": {\
                 "enableSecureBoot": true,\
                 "enableVTPM": true\
           },\
       }\
       ],
}
```


For more information, see [Azure Linux with OS Guard for AKS](https://learn.microsoft.com/en-us/azure/aks/use-azure-linux-os-guard).

[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-8)

##### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command. **Flatcar Container Linux requires a minimum of 18.0.0b42**.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AKSFlatcarPreview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-aksflatcarpreview-feature-flag-3)

##### Register the `AKSFlatcarPreview` feature flag

1. Register the `AKSFlatcarPreview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AKSFlatcarPreview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AKSFlatcarPreview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Flatcar Container Linux for AKS node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-flatcar-container-linux-for-aks-node-pools)

##### Create the Flatcar Container Linux for AKS node pools

- Create multiple Flatcar Container Linux for AKS (preview) node pools in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "3",\
          "osSKU": "flatcar",\
          "osType": "linux"\
       }\
       ],
}
```


For more information, see [Flatcar Container Linux for AKS](https://learn.microsoft.com/en-us/azure/aks/flatcar-container-linux-for-aks).

[Section titled: Add Windows Server node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#add-windows-server-node-pools)

### Add Windows Server node pools

- [Modify JSON to create multiple Windows Server 2025 (preview) node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_6_ws2025-arm)
- [Modify JSON to create multiple Windows Server 2022 node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#tabpanel_6_ws2022-arm)

[Section titled: Install the aks-preview extension](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#install-the-aks-preview-extension-9)

##### Install the `aks-preview` extension

1. Install the `aks-preview` Azure CLI extension using the [`az extension add`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-add) command.



Important



AKS preview features are available on a self-service, opt-in basis. Previews are provided "as is" and "as available," and they're excluded from the service-level agreements and limited warranty. AKS previews are partially covered by customer support on a best-effort basis. As such, these features aren't meant for production use. For more information, see the following support articles:



   - [AKS support policies](https://learn.microsoft.com/en-us/azure/aks/support-policies)
   - [Azure support FAQ](https://learn.microsoft.com/en-us/azure/aks/faq)

Azure CLI


CopyOpen Cloud Shell

```azurecli
az extension add --name aks-preview
```

2. Update to the latest version of the extension using the [`az extension update`](https://learn.microsoft.com/en-us/cli/azure/extension#az-extension-update) command. **Windows Server 2025 requires a minimum of 18.0.0b5**.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az extension update --name aks-preview
```


[Section titled: Register the AksWindows2025Preview feature flag](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#register-the-akswindows2025preview-feature-flag-1)

##### Register the `AksWindows2025Preview` feature flag

1. Register the `AksWindows2025Preview` feature flag using the [`az feature register`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature register --namespace "Microsoft.ContainerService" --name "AksWindows2025Preview"
```

2. Verify the registration status using the [`az feature show`](https://learn.microsoft.com/en-us/cli/azure/feature#az-feature-show) command. It takes a few minutes for the status to show _Registered_.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az feature show --namespace Microsoft.ContainerService --name AksWindows2025Preview
```

3. When the status reflects _Registered_, refresh the registration of the _Microsoft.ContainerService_ resource provider using the [`az provider register`](https://learn.microsoft.com/en-us/cli/azure/provider#az-provider-register) command.


    Azure CLI


CopyOpen Cloud Shell




```azurecli
az provider register --namespace Microsoft.ContainerService
```


[Section titled: Create the Windows Server 2025 node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#create-the-windows-server-2025-node-pools)

##### Create the Windows Server 2025 node pools

- Create multiple Windows node pools in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "3",\
          "osSKU": "windows2025",\
          "osType": "windows"\
       }\
       ],
}
```


- Create multiple Windows node pools in your AKS cluster by making the following modifications to your ARM template:


JSON


Copy




```json
    "properties": {
      "agentPoolProfiles": [\
      {\
          "count": "3",\
          "osSKU": "windows2022",\
          "osType": "windows"\
       }\
       ],
}
```


[Section titled: Deploy your ARM template](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#deploy-your-arm-template)

## Deploy your ARM template

- Deploy your ARM template by following the guidance in [Deploy an Azure Kubernetes Service (AKS) cluster using an ARM template](https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-deploy-rm-template).

[Section titled: Set taints, labels, or tags for a node pool](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#set-taints-labels-or-tags-for-a-node-pool)

## Set taints, labels, or tags for a node pool

When creating a node pool, you can add taints, labels, or tags to it. When you add a taint, label, or tag, all nodes within that node pool also get that taint, label, or tag. We recommend applying these properties to an entire node pool instead of individual nodes. This way, you can easily manage the properties of all nodes in the node pool by updating the node pool properties instead of updating each node individually.

For specific instructions on how to set taints, labels, or tags for a node pool, use the following resources:

- [Use node taints in an Azure Kubernetes Service (AKS) cluster](https://learn.microsoft.com/en-us/azure/aks/use-node-taints)
- [Use labels in an Azure Kubernetes Service (AKS) cluster](https://learn.microsoft.com/en-us/azure/aks/use-labels)
- [Use Azure tags in Azure Kubernetes Service (AKS)](https://learn.microsoft.com/en-us/azure/aks/use-tags)
- [Provide dedicated nodes using taints and tolerations in Azure Kubernetes Service (AKS)](https://learn.microsoft.com/en-us/azure/aks/operator-best-practices-advanced-scheduler#provide-dedicated-nodes-using-taints-and-tolerations)

[Section titled: Next steps](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#next-steps)

## Next steps

In this article, you learned how to create an AKS cluster with a single node pool and add additional node pools to your cluster. To learn more about how to manage your node pools, see the following articles:

- [Upgrade node pools in Azure Kubernetes Service (AKS)](https://learn.microsoft.com/en-us/azure/aks/upgrade-node-pools)
- [Scale node pools in Azure Kubernetes Service (AKS)](https://learn.microsoft.com/en-us/azure/aks/scale-node-pools)
- [Assign capacity reservation groups to Azure Kubernetes Service (AKS) node pools](https://learn.microsoft.com/en-us/azure/aks/use-capacity-reservation-groups)
- [Delete an Azure Kubernetes Service (AKS) node pool](https://learn.microsoft.com/en-us/azure/aks/delete-node-pool)

* * *

## Feedback

Was this page helpful?


YesNoNo

Need help with this topic?


Want to try using Ask Learn to clarify or guide you through this topic?


Ask LearnAsk Learn

Suggest a fix?

* * *

## Additional resources

* * *

- Last updated on 12/02/2025

Ask Learn is an AI assistant that can answer questions, clarify concepts, and define terms using trusted Microsoft documentation.

Please sign in to use Ask Learn.

[Sign in](https://learn.microsoft.com/en-us/azure/aks/create-node-pools?tabs=ubuntu%2Cws2025%2Cubuntu-arm%2Cws2025-arm&pivots=azure-cli#)