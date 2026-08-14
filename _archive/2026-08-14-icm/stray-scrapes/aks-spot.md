Table of contents Exit editor mode

Ask LearnAsk Learn

Reading modeTable of contents[Read in English](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool)Add to CollectionsAdd to plan[Edit](https://github.com/MicrosoftDocs/azure-aks-docs/blob/main/articles/aks/spot-node-pool.md)

* * *

Copy MarkdownPrint

* * *

Note

Access to this page requires authorization. You can try [signing in](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#) or changing directories.


Access to this page requires authorization. You can try changing directories.


# Add an Azure Spot node pool to an Azure Kubernetes Service (AKS) cluster

Feedback

Summarize this article for me


[Deploy and Explore](https://go.microsoft.com/fwlink/?linkid=2321851)

In this article, you add a secondary Spot node pool to an existing Azure Kubernetes Service (AKS) cluster.

A Spot node pool is a node pool backed by an [Azure Spot Virtual Machine scale set](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/use-spot). With Spot VMs in your AKS cluster, you can take advantage of unutilized Azure capacity with significant cost savings. The amount of available unutilized capacity varies based on many factors, such as node size, region, and time of day.

When you deploy a Spot node pool, Azure allocates the Spot nodes if there's capacity available and deploys a Spot scale set that backs the Spot node pool in a single default domain. There's no SLA for the Spot nodes. There are no high availability guarantees. If Azure needs capacity back, the Azure infrastructure evicts the Spot nodes.

Spot nodes are great for workloads that can handle interruptions, early terminations, or evictions. For example, workloads such as batch processing jobs, development and testing environments, and large compute workloads might be good candidates to schedule on a Spot node pool.

[Section titled: Before you begin](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#before-you-begin)

## Before you begin

- This article assumes a basic understanding of Kubernetes and Azure Load Balancer concepts. For more information, see [Kubernetes core concepts for Azure Kubernetes Service (AKS)](https://learn.microsoft.com/en-us/azure/aks/concepts-clusters-workloads).
- If you don't have an Azure subscription, create a [free account](https://azure.microsoft.com/pricing/purchase-options/azure-account?cid=msft_learn_6fa1c200-3210-e83c-13a2-fc2a392f7188) before you begin.
- When you create a cluster to use a Spot node pool, the cluster must use Virtual Machine Scale Sets for node pools and the _Standard_ SKU load balancer. You must also add another node pool after you create your cluster, which is covered in this tutorial.
- This article requires that you're running the Azure CLI version 2.14 or later. Run `az --version` to find the version. If you need to install or upgrade, see [Install Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli).

[Section titled: Limitations](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#limitations)

### Limitations

The following limitations apply when you create and manage AKS clusters with a Spot node pool:

- A Spot node pool can't be a default node pool, it can only be used as a secondary pool.
- You can't upgrade the control plane and node pools at the same time. You must upgrade them separately or remove the Spot node pool to upgrade the control plane and remaining node pools at the same time.
- A Spot node pool must use Virtual Machine Scale Sets.
- You can't change `ScaleSetPriority` or `SpotMaxPrice` after creation.
- When setting `SpotMaxPrice`, the value must be _-1_ or a _positive value with up to five decimal places_.
- A Spot node pool has the `kubernetes.azure.com/scalesetpriority:spot` label, the `kubernetes.azure.com/scalesetpriority=spot:NoSchedule` taint, and the system pods have anti-affinity.
- You must add a [corresponding toleration](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#verify-the-spot-node-pool) and affinity to schedule workloads on a Spot node pool.

[Section titled: Add a Spot node pool to an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#add-a-spot-node-pool-to-an-aks-cluster)

## Add a Spot node pool to an AKS cluster

When adding a Spot node pool to an existing cluster, it must be a cluster with multiple node pools enabled. When you create an AKS cluster with multiple node pools enabled, you create a node pool with a `priority` of `Regular` by default. To add a Spot node pool, you must specify `Spot` as the value for `priority`. For more details on creating an AKS cluster with multiple node pools, see [use multiple node pools](https://learn.microsoft.com/en-us/azure/aks/create-node-pools).

- Create a node pool with a `priority` of `Spot` using the [`az aks nodepool add`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-add) command.

Azure CLI


CopyOpen Cloud Shell

```azurecli
export SPOT_NODEPOOL="spotnodepool"

az aks nodepool add \
    --resource-group $RESOURCE_GROUP \
    --cluster-name $AKS_CLUSTER \
    --name $SPOT_NODEPOOL \
    --priority Spot \
    --eviction-policy Delete \
    --spot-max-price -1 \
    --enable-cluster-autoscaler \
    --min-count 1 \
    --max-count 3 \
    --no-wait
```

In the previous command, the `priority` of `Spot` makes the node pool a Spot node pool. The `eviction-policy` parameter is set to `Delete`, which is the default value. When you set the [eviction policy](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/use-spot#eviction-policy) to `Delete`, nodes in the underlying scale set of the node pool are deleted when they're evicted.

You can also set the eviction policy to `Deallocate`, which means that the nodes in the underlying scale set are set to the _stopped-deallocated_ state upon eviction. Nodes in the _stopped-deallocated_ state count against your compute quota and can cause issues with cluster scaling or upgrading. The `priority` and `eviction-policy` values can only be set during node pool creation. Those values can't be updated later.

The previous command also enables the [cluster autoscaler](https://learn.microsoft.com/en-us/azure/aks/cluster-autoscaler), which we recommend using with Spot node pools. Based on the workloads running in your cluster, the cluster autoscaler scales the number of nodes up and down. For Spot node pools, the cluster autoscaler will scale up the number of nodes after an eviction if more nodes are still needed. If you change the maximum number of nodes a node pool can have, you also need to adjust the `maxCount` value associated with the cluster autoscaler. If you don't use a cluster autoscaler, upon eviction, the Spot pool will eventually decrease to _0_ and require manual operation to receive any additional Spot nodes.

Important

Only schedule workloads on Spot node pools that can handle interruptions, such as batch processing jobs and testing environments. We recommend you set up [taints and tolerations](https://learn.microsoft.com/en-us/azure/aks/operator-best-practices-advanced-scheduler#provide-dedicated-nodes-using-taints-and-tolerations) on your Spot node pool to ensure that only workloads that can handle node evictions are scheduled on a Spot node pool. For example, the above command adds a taint of `kubernetes.azure.com/scalesetpriority=spot:NoSchedule`, so only pods with a corresponding toleration are scheduled on this node.

[Section titled: Verify the Spot node pool](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#verify-the-spot-node-pool)

## Verify the Spot node pool

- Verify your node pool was added using the [`az aks nodepool show`](https://learn.microsoft.com/en-us/cli/azure/aks/nodepool#az-aks-nodepool-show) command and confirming the `scaleSetPriority` is `Spot`.

Azure CLI


CopyOpen Cloud Shell

```azurecli
az aks nodepool show --resource-group $RESOURCE_GROUP --cluster-name $AKS_CLUSTER --name $SPOT_NODEPOOL
```

Results:

JSON


Copy

```json
{
  "artifactStreamingProfile": null,
  "availabilityZones": null,
  "capacityReservationGroupId": null,
  "count": 3,
  "creationData": null,
  "currentOrchestratorVersion": "1.30.10",
  "eTag": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "enableAutoScaling": true,
  "enableCustomCaTrust": false,
  "enableEncryptionAtHost": false,
  "enableFips": false,
  "enableNodePublicIp": false,
  "enableUltraSsd": false,
  "gatewayProfile": null,
  "gpuInstanceProfile": null,
  "gpuProfile": null,
  "hostGroupId": null,
  "id": "/subscriptions/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/resourcegroups/xxxxxxxxxxxxxxxx/providers/Microsoft.ContainerService/managedClusters/xxxxxxxxxxxxxxxx/agentPools/xxxxxxxxxxxx",
  "kubeletConfig": null,
  "kubeletDiskType": "OS",
  "linuxOsConfig": null,
  "maxCount": 3,
  "maxPods": 30,
  "messageOfTheDay": null,
  "minCount": 1,
  "mode": "User",
  "name": "xxxxxxxxxxxx",
  "networkProfile": {
    "allowedHostPorts": null,
    "applicationSecurityGroups": null,
    "nodePublicIpTags": null
  },
  "nodeImageVersion": "AKSUbuntu-2204gen2containerd-xxxxxxxx.xx.x",
  "nodeInitializationTaints": null,
  "nodeLabels": {
    "kubernetes.azure.com/scalesetpriority": "spot"
  },
  "nodePublicIpPrefixId": null,
  "nodeTaints": [\
    "kubernetes.azure.com/scalesetpriority=spot:NoSchedule"\
  ],
  "orchestratorVersion": "x.xx.xx",
  "osDiskSizeGb": 128,
  "osDiskType": "Managed",
  "osSku": "Ubuntu",
  "osType": "Linux",
  "podIpAllocationMode": null,
  "podSubnetId": null,
  "powerState": {
    "code": "Running"
  },
  "provisioningState": "Creating",
  "proximityPlacementGroupId": null,
  "resourceGroup": "xxxxxxxxxxxxxxxx",
  "scaleDownMode": "Delete",
  "scaleSetEvictionPolicy": "Delete",
  "scaleSetPriority": "Spot",
  "securityProfile": {
    "enableSecureBoot": false,
    "enableVtpm": false,
    "sshAccess": "LocalUser"
  },
  "spotMaxPrice": -1.0,
  "status": null,
  "tags": null,
  "type": "Microsoft.ContainerService/managedClusters/agentPools",
  "typePropertiesType": "VirtualMachineScaleSets",
  "upgradeSettings": {
    "drainTimeoutInMinutes": null,
    "maxSurge": null,
    "maxUnavailable": null,
    "nodeSoakDurationInMinutes": null,
    "undrainableNodeBehavior": null
  },
  "virtualMachineNodesStatus": null,
  "virtualMachinesProfile": null,
  "vmSize": "Standard_DS2_v2",
  "vnetSubnetId": null,
  "windowsProfile": null,
  "workloadRuntime": "OCIContainer"
}
```

[Section titled: Schedule a pod to run on the Spot node](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#schedule-a-pod-to-run-on-the-spot-node)

## Schedule a pod to run on the Spot node

To schedule a pod to run on a Spot node, you can add a toleration and node affinity that corresponds to the taint applied to your Spot node.

The following example shows a portion of a YAML file that defines a toleration corresponding to the `kubernetes.azure.com/scalesetpriority=spot:NoSchedule` taint and a node affinity corresponding to the `kubernetes.azure.com/scalesetpriority=spot` label used in the previous step with `requiredDuringSchedulingIgnoredDuringExecution` and `preferredDuringSchedulingIgnoredDuringExecution` node affinity rules:

YAML


Copy

```yaml
spec:
  containers:
  - name: spot-example
  tolerations:
  - key: "kubernetes.azure.com/scalesetpriority"
    operator: "Equal"
    value: "spot"
    effect: "NoSchedule"
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: "kubernetes.azure.com/scalesetpriority"
            operator: In
            values:
            - "spot"
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 1
        preference:
          matchExpressions:
          - key: another-node-label-key
            operator: In
            values:
            - another-node-label-value
```

When you deploy a pod with this toleration and node affinity, Kubernetes successfully schedules the pod on the nodes with the taint and label applied. In this example, the following rules apply:

- The node _must_ have a label with the key `kubernetes.azure.com/scalesetpriority`, and the value of that label _must_ be `spot`.
- The node _preferably_ has a label with the key `another-node-label-key`, and the value of that label _must_ be `another-node-label-value`.

For more information, see [Assigning pods to nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity).

[Section titled: Upgrade a Spot node pool](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#upgrade-a-spot-node-pool)

## Upgrade a Spot node pool

When you upgrade a Spot node pool, AKS internally issues a cordon and an eviction notice, but no drain is applied. There are no surge nodes available for Spot node pool upgrades. Outside of these changes, the behavior when upgrading Spot node pools is consistent with that of other node pool types.

For more information on upgrading, see [Upgrade an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/upgrade-cluster).

[Section titled: Max price for a Spot pool](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#max-price-for-a-spot-pool)

## Max price for a Spot pool

[Pricing for Spot instances is variable](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/use-spot#pricing), based on region and SKU. For more information, see pricing information for [Linux](https://azure.microsoft.com/pricing/details/virtual-machine-scale-sets/linux/) and [Windows](https://azure.microsoft.com/pricing/details/virtual-machine-scale-sets/windows/).

With variable pricing, you have the option to set a max price, in US dollars (USD) using up to five decimal places. For example, the value _0.98765_ would be a max price of _$0.98765 USD per hour_. If you set the max price to _-1_, the instance won't be evicted based on price. As long as there's capacity and quota available, the price for the instance will be the lower price of either the current price for a Spot instance or for a standard instance.

[Section titled: Next steps](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#next-steps)

## Next steps

In this article, you learned how to add a Spot node pool to an AKS cluster. For more information about how to control pods across node pools, see [Best practices for advanced scheduler features in AKS](https://learn.microsoft.com/en-us/azure/aks/operator-best-practices-advanced-scheduler).

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

- Last updated on 04/06/2025

Ask Learn is an AI assistant that can answer questions, clarify concepts, and define terms using trusted Microsoft documentation.

Please sign in to use Ask Learn.

[Sign in](https://learn.microsoft.com/en-us/azure/aks/spot-node-pool#)