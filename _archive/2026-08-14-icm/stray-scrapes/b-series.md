Table of contents Exit editor mode

Ask LearnAsk Learn

Reading modeTable of contents[Read in English](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic)Add to CollectionsAdd to plan[Edit](https://github.com/MicrosoftDocs/azure-compute-docs/blob/main/articles/virtual-machines/sizes/general-purpose/bv1-series.md)

* * *

Copy MarkdownPrint

* * *

Note

Access to this page requires authorization. You can try [signing in](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#) or changing directories.


Access to this page requires authorization. You can try changing directories.


# Bv1 sizes series

Feedback

Summarize this article for me


Note

These virtual machine sizes are a [**previous generation series**](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list). While older VM sizes are supported until further notice, we recommended using newer generations for improved performance and security. Check out the sizes overview's [**list of VM size families by type**](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview#list-of-vm-size-families-by-type) for a selection of newer sizes.

The B-series VMs can be deployed on various hardware types and processors, so competitive bandwidth allocation is provided. B-series run on the third Generation Intel® Xeon® Platinum 8370C (Ice Lake), the Intel® Xeon® Platinum 8272CL (Cascade Lake), the Intel® Xeon® 8171M 2.1 GHz (Skylake), the Intel® Xeon® E5-2673 v4 2.3 GHz (Broadwell), or the Intel® Xeon® E5-2673 v3 2.4 GHz (Haswell) processors. B-series VMs are ideal for workloads that don't need the full performance of the CPU continuously, like web servers, proof of concepts, small databases, and development build environments. These workloads typically have burstable performance requirements. To determine the physical hardware on which this size is deployed, query the virtual hardware from within the virtual machine. The B-series provides you with the ability to purchase a VM size with baseline performance that can build up credits when its using less than its baseline. When the VM has accumulated credits, the VM can burst above the baseline using up to 100% of the vCPU when your application requires higher CPU performance.

Read more about the [B-series CPU credit model](https://learn.microsoft.com/en-us/azure/virtual-machines/b-series-cpu-credit-model/b-series-cpu-credit-model).

[Section titled: Host specifications](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#host-specifications)

## Host specifications

Expand table

| Part | Quantity <br>Count Units | Specs <br>SKU ID, Performance Units, etc. |
| --- | --- | --- |
| Processor | 1 - 20 vCPUs | Intel Xeon Platinum 8370C (Ice Lake) \[x86-64\] <br>Intel Xeon Platinum 8272CL (Cascade Lake) \[x86-64\] <br>Intel Xeon 8171M (Skylake) \[x86-64\] <br>Intel Xeon E5-2673 v4 (Broadwell) \[x86-64\] <br>Intel Xeon E5-2673 v3 (Haswell) \[x86-64\] |
| Memory | 0.5 - 80 GiB |  |
| Local Storage | 1 Disk | 4 - 160 GiB <br> IOPS <br> MBps |
| Remote Storage | 2 - 32 Disks | 160 - 4,000 IOPS <br>10 - 50 MBps |
| Network | 2 - 8 NICs | Mbps |
| Accelerators | None |  |

For features supported by this series, see the [Feature support](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#feature-support) section.

[Section titled: Sizes in series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#sizes-in-series)

## Sizes in series

- [Basics](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#tabpanel_1_sizebasic)
- [CPU Burst](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#tabpanel_1_sizeburstdata)
- [Local Storage](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#tabpanel_1_sizestoragelocal)
- [Remote Storage](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#tabpanel_1_sizestorageremote)
- [Network](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#tabpanel_1_sizenetwork)
- [Accelerators](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#tabpanel_1_sizeaccelerators)

vCPUs (Qty.) and Memory for each size

Expand table

| Size Name | vCPUs (Qty.) | Memory (GB) |
| --- | --- | --- |
| Standard\_B1ls2 | 1 | 0.5 |
| Standard\_B1s | 1 | 1 |
| Standard\_B1ms | 1 | 2 |
| Standard\_B2s | 2 | 4 |
| Standard\_B2ms | 2 | 8 |
| Standard\_B4ms | 4 | 16 |
| Standard\_B8ms | 8 | 32 |
| Standard\_B12ms | 12 | 48 |
| Standard\_B16ms | 16 | 64 |
| Standard\_B20ms | 20 | 80 |

[Section titled: VM Basics resources](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#vm-basics-resources)

#### VM Basics resources

- [Check vCPU quotas](https://learn.microsoft.com/en-us/azure/virtual-machines/quotas)

Base CPU performance, Credits, and other CPU bursting related info

Expand table

| Size Name | Base CPU Performance of VM (%)1 | Initial Credits (Qty.) | Credits banked/hour (Qty.) | Max Banked Credits (Qty.) |
| --- | --- | --- | --- | --- |
| Standard\_B1ls | 5% | 30 | 3 | 72 |
| Standard\_B1s | 10% | 30 | 6 | 144 |
| Standard\_B1ms | 20% | 30 | 12 | 288 |
| Standard\_B2s | 20% | 60 | 24 | 576 |
| Standard\_B2ms | 30% | 60 | 36 | 864 |
| Standard\_B4ms | 22.5% | 120 | 54 | 1,296 |
| Standard\_B8ms | 17% | 240 | 81 | 1994 |
| Standard\_B12ms | 17% | 360 | 121 | 2,908 |
| Standard\_B16ms | 17% | 480 | 162 | 3,888 |
| Standard\_B20ms | 17% | 600 | 202 | 4,867 |

[Section titled: CPU Burst resources](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#cpu-burst-resources)

#### CPU Burst resources

- 1The base CPU performance metric hasn't changed. The updated (2024) numbers were normalized using a `0 - 100%` scale. Previously, the scale was `0 - (vCPU x 100%)`.
- B-series VMs can burst their disk performance and get up to their bursting max for up to 30 minutes at a time.
- B1ls is supported only on Linux
- Learn more about [CPU bursting](https://learn.microsoft.com/en-us/azure/virtual-machines/b-series-cpu-credit-model/b-series-cpu-credit-model)

Local (temp) storage info for each size

Expand table

| Size Name | Max Temp Storage Disks (Qty.) | Temp Disk Size (GiB) |
| --- | --- | --- |
| Standard\_B1ls2 | 1 | 4 |
| Standard\_B1s | 1 | 4 |
| Standard\_B1ms | 1 | 4 |
| Standard\_B2s | 1 | 8 |
| Standard\_B2ms | 1 | 16 |
| Standard\_B4ms | 1 | 32 |
| Standard\_B8ms | 1 | 64 |
| Standard\_B12ms | 1 | 96 |
| Standard\_B16ms | 1 | 128 |
| Standard\_B20ms | 1 | 160 |

[Section titled: Storage resources](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#storage-resources)

#### Storage resources

- [Introduction to Azure managed disks](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)
- [Azure managed disk types](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types)
- [Share an Azure managed disk](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-shared)

[Section titled: Table definitions](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#table-definitions)

#### Table definitions

- 1Temp disk speed often differs between RR (Random Read) and RW (Random Write) operations. RR operations are typically faster than RW operations. The RW speed is usually slower than the RR speed on series where only the RR speed value is listed.
- Storage capacity is shown in units of GiB or 1,024^3 bytes. When you compare disks measured in GB (1,000^3 bytes) to disks measured in GiB (1,024^3) remember that capacity numbers given in GiB may appear smaller. For example, 1,023 GiB = 1,098.4 GB.
- Disk throughput is measured in input/output operations per second (IOPS) and MBps where MBps = 10^6 bytes/sec.
- To learn how to get the best storage performance for your VMs, see [Virtual machine and disk performance](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-performance).

Remote (uncached) storage info for each size

Expand table

| Size Name | Max Remote Storage Disks (Qty.) | Uncached Premium SSD IOPS | Uncached Premium SSD Throughput (MBps) | Uncached Premium SSD Burst1 IOPS | Uncached Premium SSD Burst1 Throughput (MBps) |
| --- | --- | --- | --- | --- | --- |
| Standard\_B1ls2 | 2 | 160 | 10 | 4,000 | 100 |
| Standard\_B1s | 2 | 320 | 10 | 4,000 | 100 |
| Standard\_B1ms | 2 | 640 | 10 | 4,000 | 100 |
| Standard\_B2s | 4 | 1,280 | 15 | 4,000 | 100 |
| Standard\_B2ms | 4 | 1920 | 22.5 | 4,000 | 100 |
| Standard\_B4ms | 8 | 2,880 | 35 | 8,000 | 200 |
| Standard\_B8ms | 16 | 4,320 | 50 | 8,000 | 200 |
| Standard\_B12ms | 16 | 4,320 | 50 | 16,000 | 400 |
| Standard\_B16ms | 32 | 4,320 | 50 | 16,000 | 400 |
| Standard\_B20ms | 32 | 4,320 | 50 | 16,000 | 400 |

[Section titled: Storage resources](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#storage-resources-1)

#### Storage resources

- [Introduction to Azure managed disks](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)
- [Azure managed disk types](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types)
- [Share an Azure managed disk](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-shared)

[Section titled: Table definitions](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#table-definitions-1)

#### Table definitions

- 1Some sizes support [bursting](https://learn.microsoft.com/en-us/azure/virtual-machines/disk-bursting) to temporarily increase disk performance. Burst speeds can be maintained for up to 30 minutes at a time.

- Storage capacity is shown in units of GiB or 1,024^3 bytes. When you compare disks measured in GB (1,000^3 bytes) to disks measured in GiB (1,024^3) remember that capacity numbers given in GiB may appear smaller. For example, 1,023 GiB = 1,098.4 GB.

- Disk throughput is measured in input/output operations per second (IOPS) and MBps where MBps = 10^6 bytes/sec.

- Data disks can operate in cached or uncached modes. For cached data disk operation, the host cache mode is set to ReadOnly or ReadWrite. For uncached data disk operation, the host cache mode is set to None.

- To learn how to get the best storage performance for your VMs, see [Virtual machine and disk performance](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-performance).


Network interface info for each size

Expand table

| Size Name | Max NICs (Qty.) |
| --- | --- |
| Standard\_B1ls2 | 2 |
| Standard\_B1s | 2 |
| Standard\_B1ms | 2 |
| Standard\_B2s | 3 |
| Standard\_B2ms | 3 |
| Standard\_B4ms | 4 |
| Standard\_B8ms | 4 |
| Standard\_B12ms | 6 |
| Standard\_B16ms | 8 |
| Standard\_B20ms | 8 |

[Section titled: Networking resources](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#networking-resources)

#### Networking resources

- [Virtual networks and virtual machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-network/network-overview)
- [Virtual machine network bandwidth](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-machine-network-throughput)

[Section titled: Table definitions](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#table-definitions-2)

#### Table definitions

- Expected network bandwidth is the maximum aggregated bandwidth allocated per VM type across all NICs, for all destinations. For more information, see [Virtual machine network bandwidth](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-machine-network-throughput)
- Upper limits aren't guaranteed. Limits offer guidance for selecting the right VM type for the intended application. Actual network performance will depend on several factors including network congestion, application loads, and network settings. For information on optimizing network throughput, see [Optimize network throughput for Azure virtual machines](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-optimize-network-bandwidth).
- To achieve the expected network performance on Linux or Windows, you may need to select a specific version or optimize your VM. For more information, see [Bandwidth/Throughput testing (NTTTCP)](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-bandwidth-testing).

Accelerator (GPUs, FPGAs, etc.) info for each size

Note

No accelerators are present in this series.

[Section titled: Feature support](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#feature-support)

## Feature support

Expand table

| Feature name | Support status |
| --- | --- |
| [Premium Storage](https://learn.microsoft.com/en-us/azure/virtual-machines/premium-storage-performance) | Supported |
| [Premium Storage caching](https://learn.microsoft.com/en-us/azure/virtual-machines/premium-storage-performance) | Not Supported |
| [Live Migration](https://learn.microsoft.com/en-us/azure/virtual-machines/maintenance-and-updates) | Supported |
| [Memory Preserving Updates](https://learn.microsoft.com/en-us/azure/virtual-machines/maintenance-and-updates) | Supported |
| [Generation 2 VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/generation-2) | Supported |
| [Generation 1 VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/generation-2) | Supported |
| [Accelerated Networking](https://learn.microsoft.com/en-us/azure/virtual-network/create-vm-accelerated-networking-cli) | Supported |
| [Ephemeral OS Disk](https://learn.microsoft.com/en-us/azure/virtual-machines/ephemeral-os-disks) | Supported |
| [Nested Virtualization](https://learn.microsoft.com/en-us/virtualization/hyper-v-on-windows/user-guide/nested-virtualization) | Not Supported |

Note

[Accelerated Networking](https://learn.microsoft.com/en-us/azure/virtual-network/create-vm-accelerated-networking-cli) is only supported for Standard\_B12ms, Standard\_B16ms and Standard\_B20ms.

[Section titled: Other size information](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#other-size-information)

## Other size information

List of all available sizes: [Sizes](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes)

Pricing Calculator: [Pricing Calculator](https://azure.microsoft.com/pricing/calculator/)

Information on Disk Types: [Disk Types](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types)

[Section titled: Next steps](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#next-steps)

## Next steps

Take advantage of the latest performance and features available for your workloads by [changing the size of a virtual machine](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/resize-vm).

Utilize Microsoft's in-house designed ARM processors with [Azure Cobalt VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/cobalt-overview).

Learn how to [Monitor Azure virtual machines](https://learn.microsoft.com/en-us/azure/virtual-machines/monitor-vm).

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

Training


Learning path


[Run high-performance computing (HPC) applications on Azure - Training](https://learn.microsoft.com/en-us/training/paths/run-high-performance-computing-applications-azure/?source=recommendations)

Azure HPC is a purpose-built cloud capability for HPC & AI workload, using leading-edge processors and HPC-class InfiniBand interconnect, to deliver the best application performance, scalability, and value. Azure HPC enables users to unlock innovation, productivity, and business agility, through a highly available range of HPC & AI technologies that can be dynamically allocated as your business and technical needs change. This learning path is a series of modules that help you get started on Azure HPC - you


Certification


[Microsoft Certified: Azure Virtual Desktop Specialty - Certifications](https://learn.microsoft.com/en-us/credentials/certifications/azure-virtual-desktop-specialty/?source=recommendations)

Plan, deliver, manage, and monitor virtual desktop experiences and remote apps on Microsoft Azure for any device.


* * *

- Last updated on 03/11/2026

Ask Learn is an AI assistant that can answer questions, clarify concepts, and define terms using trusted Microsoft documentation.

Please sign in to use Ask Learn.

[Sign in](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bv1-series?tabs=sizebasic#)