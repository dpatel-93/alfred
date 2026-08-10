Table of contents Exit editor mode

Ask LearnAsk Learn

Reading modeTable of contents[Read in English](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist)Add to CollectionsAdd to plan[Edit](https://github.com/MicrosoftDocs/azure-compute-docs/blob/main/articles/virtual-machines/sizes/overview.md)

* * *

Copy MarkdownPrint

* * *

Note

Access to this page requires authorization. You can try [signing in](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#) or changing directories.


Access to this page requires authorization. You can try changing directories.


# Sizes for virtual machines in Azure

Feedback

Summarize this article for me


**Applies to:** ✔️ Linux VMs ✔️ Windows VMs ✔️ Flexible scale sets ✔️ Uniform scale sets

Azure Virtual Machine (VM) sizes are designed to provide a wide range of options for hosting your servers and their workloads in the cloud. Sizes are categorized into different families and types, each optimized for specific purposes. Users can choose the most suitable VM size based on their requirements, such as CPU, memory, storage, and network bandwidth.

This article describes what sizes are, gives an overview of the available sizes and shows different options for Azure virtual machine instances you can use to run your apps and workloads.

[![YouTube video for selecting the right size for your VM.](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/media/vm-series-video-play.png)](https://www.youtube.com/watch?v=zKUBjtof6nU)

[Section titled: VM size and series naming](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#vm-size-and-series-naming)

## VM size and series naming

Azure VM sizes follow specific naming conventions to denote varying features and specifications. Each character in the name represents different aspects of the VM. These include the VM family, number of vCPUs, and extra features like premium storage or included accelerators.

VM naming is further broken down into the 'Series' name and the 'Size' name. Size names include extra characters representing the number of vCPUs, type of storage, etc.

Expand table

| Category | Description | Links |
| --- | --- | --- |
| **Type** | Basic categorization by intended workload. | [General purpose](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#general-purpose)<br>[Compute optimized](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#compute-optimized)<br>[Memory optimized](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#memory-optimized)<br>[Storage optimized](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#storage-optimized)<br>[GPU accelerated](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#gpu-accelerated)<br>[FPGA accelerated](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#fpga-accelerated) |
| **Series** | Group of sizes with similar hardware and features. | [Enter the 'Series' tab here.](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#name-structure-breakdown) |
| **Size** | Specific VM configuration, including vCPUs, memory, and accelerators. | [Enter the 'Size' tab here.](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#name-structure-breakdown) |

[Section titled: Name structure breakdown](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#name-structure-breakdown)

### Name structure breakdown

- [Series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_1_breakdownseries)
- [Size](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_1_breakdownsize)

Here's a breakdown of a 'General purpose, **DCads\_v5**-series' size series.

![Graphic showing a breakdown of the DCadsv5 VM size series with text describing each letter and section of the name.](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/media/size-series-breakdown.png)1 Most families are represented using one letter, but others such as GPU sizes (`ND-series`, `NV-series`, etc.) use two.

2 Most subfamilies are represented with a single upper case letter, but others (such as `Ebsv5-series`) are still considered subfamilies of their parent family due to feature differences.

3 If no feature letter for a CPU is listed, the series uses Intel x86-64 CPUs. If the CPU is AMD, it's listed as `a`. If the CPU is ARM based (Microsoft Cobalt or Ampere Altra), it's listed as `p`.

4 There can be any number of extra features in a size name. There could be none (`Dv5-series`) or there could be three (`Dplds_v6-series`).

5 Version numbers only appear in the size name if there are multiple versions of the same series. If you're using the first version of a series (`HB-series`, `B-series`, etc.) it's often not included in the size name.

Note

Not all sizes will have subfamilies, support accelerators, or specify the CPU vendor. For more information on VM size naming conventions, see **[Azure VM sizes naming conventions](https://learn.microsoft.com/en-us/azure/virtual-machines/vm-naming-conventions)**.

Here's a breakdown of a 'Standard\_ **DC8ads\_v5**' size in the 'DCadsv5-series'

![Graphic showing a breakdown of the DC8ads_v5 VM size with text describing each letter and section of the name.](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/media/size-instance-breakdown.png)1 Most families are represented using one letter, but others such as GPU sizes (`ND-series`, `NV-series`, etc.) use two.

2 Most subfamilies are represented with a single upper case letter, but others (such as `Ebsv5-series`) are still considered subfamilies of their parent family due to feature differences.

3 If no feature letter for a CPU is listed, the series uses Intel x86-64 CPUs. If the CPU is AMD, it will be listed as `a`. If the CPU is ARM based (Microsoft Cobalt or Ampere Altra), it will be listed as `p`.

4 There can be any number of extra features in a size name. There could be none (`Dv5-series`) or there could be three (`Dplds_v6-series`).

5 Spacers can show up multiple times in a size name such as in the `ND_H100_v5-series`. In this case they separate the GPU ID from the rest of the size name.

6 Version numbers only appear in the size name if there are multiple versions of the same series. If you're using the first version of a series (`HB-series`, `B-series`, etc.) it's often not included in the size name.

Note

Not all sizes will have subfamilies, support accelerators, or specify the CPU vendor. For more information on VM size naming conventions, see **[Azure VM sizes naming conventions](https://learn.microsoft.com/en-us/azure/virtual-machines/vm-naming-conventions)**.

[Section titled: List of VM size families by type](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#list-of-vm-size-families-by-type)

## List of VM size families by type

This section contains a list of all current generation size series with tabs dedicated to each size family. Each group has a 'Series List' column with a linked list of all available size series, These links will bring you to the family page for that series, where you can find detailed information on each size in that series or go to the series' page for a list of sizes in that series.

To learn more about a size family, select the 'family' tab under each type section. There you can read a summary on the family, see the workloads it's recommended for, and view the full family page with specifications for all series in that family.

[Section titled: General purpose](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#general-purpose)

### General purpose

General purpose VM sizes provide balanced CPU-to-memory ratio. Ideal for testing and development, small to medium databases, and low to medium traffic web servers.

- [Family list](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_2_generalsizelist)
- [A family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_2_gen-a-fam)
- [B family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_2_gen-b-fam)
- [D family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_2_gen-d-fam)
- [DC family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_2_gen-dc-fam)

Expand table

| Family | Workloads | Series List |
| --- | --- | --- |
| [A-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/a-family) | Entry-level economical | [Av2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/a-family#av2-series)<br>[Previous-gen A-family series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list#general-purpose-previous-gen-sizes) |
| [B-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/b-family) | Burstable | [Bsv2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/b-family#bsv2-series)<br>[Basv2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/b-family#basv2-series)<br>[Bpsv2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/b-family#bpsv2-series)<br>[Previous-gen B-family series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list#general-purpose-previous-gen-sizes) |
| [D-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family) | Enterprise-grade applications <br> Relational databases <br> In-memory caching <br> Data analytics | [Dsv7 and Ddsv7 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dsv7-series-and-ddsv7-series)<br>[Dlsv7 and Dldsv7 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dlsv7-series-and-dldsv7-series)<br>[Dasv7 and Dadsv7 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dasv7-series-and-dadsv7-series)<br>[Dalsv7 and Daldsv7 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dalsv7-series-and-daldsv7-series)<br>[Dpsv6 and Dplsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dpsv6-and-dplsv6-series)<br>[Dpdsv6 and Dpldsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dpdsv6-and-dpldsv6-series)<br>[Dasv6 and Dadsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dasv6-and-dadsv6-series)<br>[Dalsv6 and Daldsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dalsv6-and-daldsv6-series)<br>[Dsv6 and Ddsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dsv6-series)<br>[Dlsv6 and Dldsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dlsv6-series)<br>[Dpsv5 and Dpdsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dpsv5-and-dpdsv5-series)<br>[Dplsv5 and Dpldsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dplsv5-and-dpldsv5-series)<br>[Dlsv5 and Dldsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dlsv5-and-dldsv5-series)<br>[Dv5 and Dsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dv5-and-dsv5-series)<br>[Ddv5 and Ddsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#ddv5-and-ddsv5-series)<br>[Dasv5 and Dadsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family#dasv5-and-dadsv5-series)<br>[Previous-gen D-family series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list#general-purpose-previous-gen-sizes) |
| [DC-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dc-family) | D-family with confidential computing | [DCasv5 and DCadsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dc-family#dcasv5-and-dcadsv5-series)<br>[DCas\_cc\_v5 and DCads\_cc\_v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dc-family#dcas_cc_v5-and-dcads_cc_v5-series)<br>[DCesv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dc-family#dcesv6-series)<br>[DCedsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dcedsv6-series)<br>[DCasv6 and DCadsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dc-family#dcasv6-and-dcadsv6-series)<br>[DCsv3 and DCdsv3-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dc-family#dcsv3-and-dcdsv3-series)<br>[Previous-gen DC-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list#general-purpose-previous-gen-sizes) |

[Section titled: A family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#a-family-1)

##### A family

The 'A' family of VM size series are one of Azure's general purpose VM instances. They're designed for entry-level workloads, such as development and test environments, small to medium databases, and low-traffic web servers.

[View the full A family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/a-family)

**Cost Efficiency:** A-series VMs are some of the most budget-friendly options available on Azure, making them a good choice for projects with limited financial resources or those that do not require high-performance compute capabilities.

**General Workloads:** A-series VMs are well-suited for handling basic applications, light web servers, and small databases that do not demand extensive CPU, memory, or I/O performance.

**Entry-Level Applications:** A-series VMs can serve as a good starting point for deploying applications that are not expected to scale significantly. They provide a platform for applications and services that require less processing power.

[Section titled: B family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#b-family-1)

##### B family

The 'B' family of VM size series are one of Azure's general purpose VM instances. While traditional Azure virtual machines provide fixed CPU performance, B-series virtual machines are the only VM type that use credits for CPU performance provisioning. B-series VMs utilize a CPU credit model to track how much CPU is consumed - the virtual machine accumulates CPU credits when a workload is operating below the base CPU performance threshold and uses credits when running above the base CPU performance threshold until all of its credits are consumed. Upon consuming all the CPU credits, a B-series virtual machine is throttled back to its base CPU performance until it accumulates the credits to CPU burst again.

[View the full B family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/b-family)

**Usage Flexibility:** B-family VMs are best suited for workloads that do not require constant full CPU performance.

**Ideal Applications:** B-family VMs are ideal applications include web servers, proof of concepts, small databases, and development build environments.

**Performance Needs:** Some workloads often have burstable performance requirements, meaning they only need high performance sporadically. B-family VMs are perfect for this use case.

[Section titled: D family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#d-family-1)

##### D family

The 'D' family of VM sizes are one of Azure's general purpose VM sizes. They're designed for a variety of demanding workloads, such as enterprise applications, web and application servers, development and test environments, and batch processing tasks. Equipped with faster processors and more memory per core than the A-series, D-series VMs offer a strong performance balance, making them suitable for applications that require both high computational power and substantial memory resources. They are particularly favored for running enterprise-grade applications, supporting moderate to high-traffic web servers, and performing data-intensive batch processing.

[View the full D family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/d-family)

**Balanced Performance:** D-series VMs provide a solid balance between CPU capabilities and memory size, which makes them suitable for most production workloads. They are equipped with faster processors compared to the A-series and provide more memory per core.

**Enterprise Applications:** They are well-suited for running enterprise applications like SAP, Microsoft Dynamics, or large relational databases that require both high computational power and substantial memory.

**Development and Test Environments:** With their balanced resources, D-series VMs are ideal for development and testing environments where developers need to simulate production conditions closely.

**Web and Application Servers:** They provide the necessary resources to host web servers and application servers that experience moderate to heavy traffic, ensuring smooth and responsive user experiences.

**Batch Processing:** D-series VMs are efficient for handling batch processing tasks that require processing large amounts of data quickly, thanks to their fast processors and ample memory.

**Gaming Servers:** The high-performance capabilities of D-series VMs make them suitable for gaming servers where latency and speed are critical for a good user experience.

[Section titled: DC family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#dc-family-1)

##### DC family

The 'DC' series family are one of Azure's security focused general purpose VM instances. They're designed for [confidential computing](https://learn.microsoft.com/en-us/azure/confidential-computing/overview-azure-products) offering enhanced data protection and integrity with various hardware-based Trusted Execution Environments (TEEs). These VMs work well for many general computing workloads, e-commerce systems, web front ends, desktop virtualization solutions, sensitive databases, other enterprise applications and more.

[View the full DC family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dc-family)

**Data Protection:** DC-series VMs are ideal for applications that manage, store, and process sensitive data, such as personal identifiable information (PII), financial data, health records, and other types of confidential information. The hardware-based encryption ensures that data is protected at rest and during processing.

**Regulatory Compliance:** For businesses that need to comply with stringent regulatory requirements for data privacy and security (like GDPR, HIPAA, or financial industry regulations), DC-series VMs provide a hardware-assured environment that can help meet these compliance demands.

[Section titled: Compute optimized](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#compute-optimized)

### Compute optimized

Compute optimized VM sizes have a high CPU-to-memory ratio. These sizes are good for medium traffic web servers, network appliances, batch processes, and application servers.

- [Family list](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_3_computesizelist)
- [F family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_3_comp-a-fam)
- [FX family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_3_comp-fx-fam)

List of compute optimized VM size families:

Expand table

| Family | Workloads | Series List |
| --- | --- | --- |
| [F-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/f-family) | Medium traffic web servers <br> Network appliances <br> Batch processes <br> Application servers | [Fasv7 and Fadsv7 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/f-family#fasv7-series-and-fadsv7-series)<br>[Famsv7 and Famdsv7 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/f-family#famsv7-series-and-famdsv7-series)<br>[Falsv7 and Faldsv7 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/f-family#falsv7-series-and-faldsv7-series)<br>[Fasv6, Falsv6, and Famsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/f-family#fasv6-falsv6-and-famsv6-series)<br>[Fsv2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/f-family#fsv2-series)<br>[Previous-gen F-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list) |
| [FX-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/fx-family) | Electronic Design Automation (EDA) <br> Large memory relational databases <br> Medium to large caches <br> In-memory analytics | [FX-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/fx-family#fx-series)<br>[FXmsv2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/fxmsv2-series)<br>[FXmdsv2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/fxmdsv2-series) |

To learn more about a specific size family or series, select the tab for that family and scroll to find your desired size series.

[Section titled: F family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#f-family-1)

##### F family

The 'F' family of VM size series are one of Azure's compute-optimized VM instances. They're designed for workloads that require high CPU performance, such as batch processing, web servers, analytics, and gaming. Featuring a high CPU-to-memory ratio, F-series VMs are equipped with powerful processors to handle applications that demand more CPU capacity relative to memory. This makes them particularly effective for scenarios where fast and efficient processing is critical, allowing businesses to run their compute-bound applications efficiently and cost-effectively.

[View the full F family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/f-family)

**Web Servers:** F-series VMs are excellent for hosting web servers and applications that require significant compute capability to handle web traffic efficiently without necessarily needing large amounts of memory.

**Batch Processing:** F-series VMs are ideal for batch jobs and other processing tasks that involve handling large volumes of data or tasks in a queue but are more CPU-intensive than memory-intensive.

**Application Servers:** Applications that require quick processing and do not have high memory demands can benefit from F-series VMs. These can include medium traffic application servers, back-end servers for enterprise applications, and other similar tasks.
Gaming Servers: Due to their high CPU performance, F-series VMs are also suitable for gaming servers where fast processing is critical for a good gaming experience.

**Analytics:** F-series VMs can be used for data analytics applications that require processing speed to crunch numbers and perform calculations more than they require a large amount of memory.

[Section titled: FX family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#fx-family-1)

##### FX family

The 'FX' family of VM size series are one of Azure's specialized compute-optimized VM instances, designed primarily workloads that require significant CPU capabilities. These VMs use the latest Intel Ice Lake processors and are optimized for compute-intensive tasks such as financial modeling, scientific simulations, and heavy calculations. With a high frequency and a large cache per core, FX-series VMs provide exceptional computational power, making them ideal for scenarios demanding extensive processing resources and rapid execution of complex operations.

[View the full FX family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/compute-optimized/fx-family)

**Electronic Design Automation (EDA)**: FX-series VMs are well-suited for EDA workloads, which require high CPU clock speeds and high memory-to-CPU ratios. These workloads benefit from the high single-core performance and large memory capacity of FX-series VMs.

**Batch Processing:** FX-series VMs are excellent for high-throughput batch processing jobs, such as those involving large-scale data analysis and transformation, where rapid processing is critical.

**Data Analytics:** FX-series VMs are suitable for intensive data analytics applications, especially those that require quick iteration and processing of large data sets.

[Section titled: Memory optimized](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#memory-optimized)

### Memory optimized

Memory optimized VM sizes offer a high memory-to-CPU ratio that is great for relational database servers, medium to large caches, and in-memory analytics.

- [Family list](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_4_memorysizelist)
- [E family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_4_mem-e-fam)
- [Eb family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_4_mem-eb-fam)
- [EC family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_4_mem-ec-fam)
- [M family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_4_mem-m-fam)

List of memory optimized VM sizes with links to each series' family page section:

Expand table

| Family | Workloads | Series List |
| --- | --- | --- |
| [E-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family) | Relational databases <br> Medium to large caches <br> In-memory analytics | [Esv7 and Edsv7-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family#esv7-and-edsv7-series)<br>[Easv7 and Eadsv7 series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family#easv7-series-and-eadsv7-series)<br>[Esv6 and Edsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/esv6-series)<br>[Epsv6 and Epdsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family#epsv6-and-epdsv6-series)<br>[Easv6 and Eadsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family#easv6-and-eadsv6-series)<br>[Ev5 and Esv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family#ev5-and-esv5-series)<br>[Edv5 and Edsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family#edv5-and-edsv5-series)<br>[Easv5 and Eadsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family#easv5-and-eadsv5-series)<br>[Epsv5 and Epdsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family#epsv5-and-epdsv5-series)<br>[Previous-gen families](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list#memory-optimized-previous-gen-sizes) |
| [Eb-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/eb-family) | E-family with High remote storage performance | [Ebsv6 and Ebdsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/eb-family#ebsv6-and-ebdsv6-series)<br>[Ebdsv5 and Ebsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/eb-family#ebdsv5-and-ebsv5-series) |
| [EC-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/ec-family) | E-family with confidential computing | [ECasv6 and ECadsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/ec-family#ecasv6-and-ecadsv6-series)<br>[ECasv5 and ECadsv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/ec-family#ecasv5-and-ecadsv5-series)<br>[ECas\_cc\_v5 and ECads\_cc\_v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/ec-family#ecas_ccv5-and-ecads_ccv5-series) |
| [M-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family) | Extremely large databases <br> Large amounts of memory | [Mbsv3 and Mbdsv3-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family#mbsv3-and-mbdsv3-series)<br>[Msv3 and Mdsv3 Medium Memory series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family#msv3-and-mdsv3-medium-memory-series)<br>[Msv3 and Mdsv3 High Memory series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family#msv3-and-mdsv3-high-memory-series)<br>[Mdsv3 Very High Memory series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family#mdsv3-very-high-memory-series)<br>[Msv2 and Mdsv2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family#msv2-and-mdsv2-medium-memory-series)<br>[Msv2 High Memory Series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family#msv2-high-memory-series)<br>[M-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family#m-series) |
| Other families | Older generation memory optimized sizes | [Dnsv6 and Dndsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/dnsv6-series)<br>[Dnlsv6 and Dnldsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/dnlsv6-series)<br>[Ensv6 and Endsv6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/ensv6-series)<br>[Previous-gen families](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list#memory-optimized-previous-gen-sizes) |

To learn more about a specific size family or series, select the tab for that family and scroll to find your desired size series.

[Section titled: E family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#e-family-1)

##### E family

The 'E' family of VM size series are one of Azure's memory-optimized VM instances. They're designed for memory-intensive workloads, such as large databases, big data analytics, and enterprise applications that require significant amounts of RAM to maintain high performance. Equipped with high memory-to-core ratios, E-series VMs support applications and services that benefit from faster data access and more efficient data processing capabilities. This makes them particularly well-suited for scenarios involving in-memory databases and extensive data processing tasks where ample memory is crucial for optimal performance.

[View the full E family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/e-family)

**Memory-Intensive Workloads:** E-family VMs are for workloads that demands a large memory footprint to efficiently handle tasks, such as simulations, large-scale computations in scientific research, or financial risk modeling.

**Large Databases and SQL Servers:** E-family VMs are ideal for hosting large relational databases like SQL Server and NoSQL databases that benefit from high memory capacities for improved performance in data processing and transaction handling.

**Enterprise Applications:** E-family VMs are suitable for resource-intensive enterprise applications, including large-scale ERP and CRM systems, where the availability of ample memory is crucial for managing complex transactions and user loads.

**Big Data Applications:** E-family VMs are effective for big data analytics applications that need to process vast amounts of data in memory to speed up analysis and insights generation.

**In-Memory Computing:** E-family VMs are great for in-memory databases (e.g., SAP HANA) that require large amounts of RAM to keep the entire dataset in memory, allowing for ultra-fast data processing and query responses.

**Data Warehousing:** E-family VMs provide the necessary resources for data warehousing solutions that handle and analyze large datasets, improving query performance and reducing response times.

[Section titled: Eb family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#eb-family-1)

##### Eb family

The 'Eb' family of VM size series are one of Azure's memory-optimized VM instances. They're designed for memory-intensive workloads with high remote storage performance, such as large databases, big data analytics, and enterprise applications that require significant amounts of RAM to maintain high performance. Equipped with high memory-to-core ratios, Eb-series VMs support applications and services that benefit from faster data access and more efficient data processing capabilities. This makes them particularly well-suited for scenarios involving in-memory databases and extensive data processing tasks where ample memory is crucial for optimal performance.

[View the full Eb family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/eb-family)

**Memory-Intensive Workloads:** Eb-family VMs are for workloads that demand a large memory footprint to efficiently handle tasks, such as simulations, large-scale computations in scientific research, or financial risk modeling.

**Large Databases and SQL Servers:** Eb-family VMs are ideal for hosting large relational databases like SQL Server and NoSQL databases that benefit from high memory capacities for improved performance in data processing and transaction handling.

**Enterprise Applications:** Eb-family VMs are suitable for resource-intensive enterprise applications, including large-scale ERP and CRM systems, where the availability of ample memory is crucial for managing complex transactions and user loads.

**Big Data Applications:** Eb-family VMs are effective for big data analytics applications that need to process vast amounts of data in memory to speed up analysis and insights generation.

**In-Memory Computing:** Eb-family VMs are great for in-memory databases (e.g., SAP HANA) that require large amounts of RAM to keep the entire dataset in memory, allowing for ultra-fast data processing and query responses.

**Data Warehousing:** Eb-family VMs provide the necessary resources for data warehousing solutions that handle and analyze large datasets, improving query performance and reducing response times.

[Section titled: EC family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#ec-family-1)

##### EC family

The 'EC' sub-family of VM size series are one of Azure's security focused memory-optimized VM instances. They're designed for [confidential computing](https://learn.microsoft.com/en-us/azure/confidential-computing/overview-azure-products) with enhanced data protection and integrity, featuring various hardware-based Trusted Execution Environments (TEEs). These instances are ideal for memory-intensive workloads, such as large databases, big data analytics, and enterprise applications that require significant amounts of RAM to maintain high performance.

[View the full EC family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/ec-family)

**Memory-Intensive Workloads:** Any workload that demands a large memory footprint to efficiently handle tasks, such as simulations, large-scale computations in scientific research, or financial risk modeling.

**Large Databases and SQL Servers:** They are ideal for hosting large relational databases like SQL Server and NoSQL databases that benefit from high memory capacities for improved performance in data processing and transaction handling.

**Enterprise Applications:** Suitable for resource-intensive enterprise applications, including large-scale ERP and CRM systems, where the availability of ample memory is crucial for managing complex transactions and user loads.

**Big Data Applications:** Effective for big data analytics applications that need to process vast amounts of data in memory to speed up analysis and insights generation.

**In-Memory Computing:** Such as in-memory databases (e.g., SAP HANA) that require large amounts of RAM to keep the entire dataset in memory, allowing for ultra-fast data processing and query responses.

**Data Warehousing:** Provides the necessary resources for data warehousing solutions that handle and analyze large datasets, improving query performance and reducing response times.

[Section titled: M family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#m-family-1)

##### M family

The 'M' family of VM size series are one of Azure's ultra memory-optimized VM instances designed for extremely memory-intensive workloads, such as large in-memory databases, data warehousing, and high-performance computing (HPC). Equipped with substantial RAM capacities and high vCPU capabilities, the M-family VMs support applications and services that require massive amounts of memory and significant computational power. High resource allocation makes the M-family particularly well-suited for handling tasks such as heavy SQL Server and other RDBMS workloads, complex scientific simulations, real-time data processing, and large-scale enterprise resource planning (ERP) systems, ensuring peak performance for the most demanding data-centric applications.

[View the full M family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/memory-optimized/m-family)

**SQL Server workloads with high memory needs:** The M-family is particularly effective for running SQL Server machines with high memory requirements, such as for [online transaction processing (OLTP)](https://learn.microsoft.com/en-us/azure/architecture/data-guide/relational-data/online-transaction-processing) or [data analytics](https://learn.microsoft.com/en-us/azure/architecture/data-guide/relational-data/online-analytical-processing).

**In-memory databases:** The M-family is particularly effective for running in-memory databases that require large amounts of RAM like [SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/in-memory-oltp/overview-and-usage-scenarios), or SAP HANA.

**Big data applications:** The M-family is ideal for handling [big data](https://learn.microsoft.com/en-us/azure/architecture/databases/guide/big-data-architectures) applications that need to process and analyze huge datasets in memory, improving performance and reducing the time to insights.

**Data warehousing:** M-family VMs provide the performance and memory needed for [data warehousing](https://learn.microsoft.com/en-us/azure/architecture/example-scenario/data/data-warehouse) applications, facilitating faster queries and better handling of large volumes of data.

**Enterprise applications:** The M-family supports large-scale enterprise applications, including ERP and CRM systems, which benefit from having more memory to manage larger datasets and more complex transactions efficiently.

**Heavy workloads in virtualized environments:** The M-family is well-equipped to handle heavy virtualized environments, offering substantial memory for hosting multiple virtual machines and applications on a single physical server.

[Section titled: Storage optimized](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#storage-optimized)

### Storage optimized

Storage optimized virtual machine (VM) sizes offer high disk throughput and IO, and are ideal for Big Data, SQL, NoSQL databases, data warehousing, and large transactional databases. Examples include Cassandra, MongoDB, Cloudera, and Redis.

- [Family list](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_5_storagesizelist)
- [L family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_5_stor-l-fam)

List of storage optimized VM size families:

Expand table

| Family | Workloads | Series List |
| --- | --- | --- |
| [L-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/storage-optimized/l-family) | High disk throughput and IO <br> Big Data <br> SQL and NoSQL databases <br> Data warehousing <br> Large transactional databases | [Lsv4-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/storage-optimized/lsv4-series)<br>[Lasv4-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/storage-optimized/lasv4-series)<br>[Laosv4-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/storage-optimized/laosv4-series)<br>[Lsv3-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/storage-optimized/l-family#lsv3-series)<br>[Lasv3-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/storage-optimized/l-family#lasv3-series)<br>[Previous-gen L-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list#storage-optimized-previous-gen-sizes) |

To learn more about a specific size family or series, select the tab for that family and scroll to find your desired size series.

[Section titled: L family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#l-family-1)

##### L family

The 'L' family of VM size series are one of Azure's storage-optimized VM instances. They're designed for workloads that require high disk throughput and I/O, such as databases, big data applications, and data warehousing. Equipped with high disk throughput and large local disk storage capacities, L-series VMs support applications and services that benefit from low latency and high sequential read and write speeds. This makes them particularly well-suited for handling tasks like large-scale log processing, real-time big data analytics, and scenarios involving large databases that perform frequent disk operations, ensuring efficient performance for storage-heavy applications.

[View the full L family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/storage-optimized/l-family)

**Big Data Applications:** L-family VMs are perfect for big data applications that need to process, analyze, and manipulate large datasets stored directly on local disks, benefiting from the high I/O performance.

**Database Servers:** L-family VMs provide the necessary local disk performance for SQL Server, MySQL, PostgreSQL, and other database servers that benefit from fast access to disk storage.

**File Servers:** L-family VMs can be used effectively as file servers within a network, handling large files and serving them with high throughput, especially useful in environments with large media files.

**Video Editing and Rendering:** The high disk throughput and capacity of L-family VMs are beneficial for video editing and rendering tasks, where large video files are frequently read and written to disk.

[Section titled: GPU accelerated](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#gpu-accelerated)

### GPU accelerated

GPU optimized VM sizes are specialized virtual machines available with single, multiple, or fractional GPUs. These sizes are designed for compute-intensive, graphics-intensive, and visualization workloads.

- [Family list](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_6_gpusizelist)
- [NC family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_6_gpu-nc-fam)
- [ND family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_6_gpu-nd-fam)
- [NG family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_6_gpu-ng-fam)
- [NV family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_6_gpu-nv-fam)

List of GPU optimized VM size families:

Expand table

| Family | Workloads | Series List |
| --- | --- | --- |
| [NC-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-family) | Compute-intensive <br> Graphics-intensive <br> Visualization | [NC\_RTXPRO6000BSE\_v6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-rtxpro6000-bse-v6-series)<br>[NCads\_H100\_v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-family#ncads_h100_v5-series)<br>[NCCads\_H100\_v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-family#nccads_h100_v5-series)<br>[NCv3-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-family#ncv3-series)<br>[NCasT4\_v3-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-family#ncast4_v3-series)<br>[NC\_A100\_v4-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-family#nc_a100_v4-series) |
| [ND-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-family) | Large memory compute-intensive <br> Large memory graphics-intensive <br> Large memory visualization | [ND GB300-v6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-gb300-v6-series)<br>[ND GB200-v6-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-gb200-v6-series)<br>[ND\_MI300X\_v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-family#nd_mi300x_v5-series)<br>[ND-H200-v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-h200-v5-series)<br>[ND-H100-v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-family#nd_h100_v5-series)<br>[NDm\_A100\_v4-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-family#ndm_a100_v4-series)<br>[ND\_A100\_v4-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-family#nd_a100_v4-series) |
| [NG-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/ng-family) | Virtual Desktop (VDI) <br> Cloud gaming | [NGads V620-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/ng-family#ngads-v620-series) |
| [NV-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nv-family) | Virtual desktop (VDI) <br> Single-precision compute <br> Video encoding and rendering | [NV-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nv-family#nv-series-v1)<br>[NVv3-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nv-family#nvv3-series)<br>[NVv4-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nv-family#nvv4-series)<br>[NVadsA10\_v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nv-family#nvads-a10-v5-series)<br>[NVads V710 v5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nvadsv710-v5-series)<br>[Previous-gen NV-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/previous-gen-sizes-list#gpu-accelerated-previous-gen-sizes) |

To learn more about a specific size family or series, select the tab for that family and scroll to find your desired size series.

[Section titled: NC family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#nc-family-1)

##### NC family

The 'NC' sub-family of VM size series are one of Azure's GPU-optimized VM instances. They're designed for compute-intensive workloads, such as AI and machine learning model training, high-performance computing (HPC), and graphics-intensive applications. Equipped with powerful NVIDIA GPUs, NC-series VMs offer substantial acceleration for processes that require heavy computational power, including deep learning, scientific simulations, and 3D rendering. This makes them particularly well-suited for industries such as technology research, entertainment, and engineering, where rendering and processing speed are critical to productivity and innovation.

[View the full NC family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-family)

**AI and Machine Learning:** NC-series VMs are ideal for training complex machine learning models and running AI applications. The NVIDIA GPUs provide significant acceleration for computations typically involved in deep learning and other intensive training tasks.

**High-Performance Computing (HPC):** These VMs are suitable for scientific simulations, rendering, and other HPC workloads that can be accelerated by GPUs. Fields like engineering, medical research, and financial modeling often use NC-series VMs to handle their computational needs efficiently.

**Graphics Rendering:** NC-series VMs are also used for graphics-intensive applications, including video editing, 3D rendering, and real-time graphics processing. They are particularly useful in industries such as game development and movie production.

**Remote Visualization:** For applications requiring high-end visualization capabilities, such as CAD and visual effects, NC-series VMs can provide the necessary GPU power remotely, allowing users to work on complex graphical tasks without needing powerful local hardware.

**Simulation and Analysis:** These VMs are also suitable for detailed simulations and analyses in areas like automotive crash testing, computational fluid dynamics, and weather modeling, where GPU capabilities can significantly speed up processing times.

[Section titled: ND family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#nd-family-1)

##### ND family

The 'ND' family of VM size series are one of Azure's GPU-accelerated VM instances. They're designed for deep learning, AI research, and high-performance computing tasks that benefit from powerful GPU acceleration. Equipped with NVIDIA GPUs, ND-series VMs offer specialized capabilities for training and inference of complex machine learning models, facilitating faster computations and efficient handling of large datasets. This makes them particularly well-suited for academic and commercial applications in AI development and simulation, where cutting-edge GPU technology is crucial for achieving rapid and accurate results in neural network processing and other computationally intensive tasks.

[View the full ND family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-family)

**AI and Deep Learning:** ND-family VMs are ideal for training and deploying complex deep learning models. Equipped with powerful NVIDIA GPUs, they provide the computational power necessary for handling extensive neural network training with large datasets, significantly reducing training times.

**High-Performance Computing (HPC):** ND-family VMs are suitable for HPC applications that require GPU acceleration. Fields such as scientific research, engineering simulations (for example, computational fluid dynamics), and genomic processing can benefit from the high-throughput computing capabilities of ND-series VMs.

[Section titled: NG family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#ng-family-1)

##### NG family

The 'NG' family of VM size series are one of Azure's GPU-optimized VM instances, specifically designed for cloud gaming and remote desktop applications. They harness powerful AMD Radeon™ PRO GPUs to deliver high-quality, interactive gaming experiences in the cloud, optimized for rendering complex graphics and streaming high-definition video. This ensures gamers enjoy a seamless, responsive gaming environment accessible from any device. Additionally, NG-series VMs provide a high-quality, responsive remote desktop experience, making them ideal for users needing reliable, high-performance access to desktop applications from anywhere in the world.

[View the full NG family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/ng-family)

**Cloud Gaming:** NG-family VMs harness powerful AMD Radeon™ PRO GPUs to deliver high-quality, interactive gaming experiences in the cloud.

**Remote Destkop:** NG-family VMs can be used for remote desktop applications, providing users with a high-quality, responsive user experience.

[Section titled: NV family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#nv-family-1)

##### NV family

The 'NV' family of VM size series are one of Azure's GPU-accelerated VM instances, specifically designed for graphics-intensive applications such as graphics rendering, simulation, and virtual desktops. Equipped with NVIDIA or AMD GPUs, NV-series VMs provide a robust platform for rendering and processing graphics-heavy tasks, making them ideal for organizations that require virtual workstations with powerful graphical capabilities. These VMs support scenarios where remote visualization, real-time collaboration, and 3D visualization are necessary, allowing users to efficiently run graphic-intensive applications directly from Azure's cloud environment.

[View the full NV family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nv-family)

**Virtual Desktop Infrastructure (VDI):** NV-family VMs are well-suited for virtual desktops that require GPU capabilities for tasks such as graphic design, video editing, and CAD applications. They provide the graphical performance necessary for smooth operation in remote desktop scenarios.

**3D Visualization:** NV-family VMs are ideal for running 3D applications that demand high-performance rendering, such as architectural visualizations, medical imaging, and other professional-grade graphics tasks.

**Remote Graphics Work:** NV-series VMs are beneficial for industries that rely on graphics-intensive software, allowing professionals to access and use applications like Adobe Photoshop, Autodesk AutoCAD, or Dassault SOLIDWORKS remotely with near-native performance.

**High-Resolution Image Processing:** NV-series VMs are ideal for handling extremely large vRAM applications such as high-resolution image processing and analysis. This includes tasks in fields like geospatial analysis, satellite image processing, and professional photo editing, where handling massive image files and performing complex manipulations in real-time are crucial for productivity and performance.

**Video Streaming:** NV-family VMs are suitable for streaming high-resolution video content, including training videos and virtual events, ensuring high-quality delivery without local hardware constraints.

[Section titled: FPGA accelerated](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#fpga-accelerated)

### FPGA accelerated

FPGA optimized VM sizes are specialized virtual machines available with single or multiple FPGAs. These sizes are designed for compute-intensive workloads. This article provides information about the number and type of FPGAs, vCPUs, data disks, and NICs. Storage throughput and network bandwidth are also included for each size in this grouping.

- [Family list](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_7_fpgasizelist)
- [NP family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_7_fpga-np-fam)

List of field programmable gate array accelerated VM size families:

Expand table

| Family | Workloads | Series List |
| --- | --- | --- |
| [NP-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/fpga-accelerated/np-family) | Machine learning inference <br> Video transcoding <br> Database search and analytics | [NP-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/fpga-accelerated/np-family#np-series) |

To learn more about a specific size family or series, select the tab for that family and scroll to find your desired size series.

[Section titled: NP family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#np-family-1)

##### NP family

The 'NP' subfamily of VM size series are Azure's FPGA-accelerated VM instances. They're designed for custom hardware acceleration scenarios, including machine learning inference, video transcoding, and database search & analytics. NP-series VMs are powered by AMD Xilinx Alveo U250 FPGAs and Intel Xeon 8171M (Skylake) CPUs.

[View the full NP family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/fpga-accelerated/np-family)

**Real-Time Data Processing:** NP-family VMs excel in environments where data needs to be processed in real time with minimal latency, such as in financial trading, real-time analytics, and network data processing.

**Custom AI and Machine Learning:** NP-family VMs are suitable for accelerating AI and machine learning inference tasks, where the FPGA can be programmed to execute specific algorithms sometimes faster than typical CPU or GPU-based solutions.

**Genomics and Life Sciences:** NP-family VMs can significantly speed up genomic sequencing tasks and other life sciences applications that benefit from custom hardware acceleration.

**Video Transcoding and Streaming:** FPGAs can be used to accelerate video processing tasks such as transcoding and real-time video streaming, optimizing performance and reducing processing times.

**Signal Processing:** NP-family VMs are ideal for applications in telecommunications and signal processing where rapid manipulation and analysis of signals are necessary.

**Database Acceleration:** NP-family VMs can enhance database operations, especially for custom search operations and large-scale database queries, by offloading these tasks to the FPGA.

[Section titled: High performance compute](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#high-performance-compute)

### High performance compute

Azure High Performance Compute VMs are optimized for various HPC workloads such as computational fluid dynamics, finite element analysis, frontend and backend EDA, rendering, molecular dynamics, computational geoscience, weather simulation, and financial risk analysis.

- [Family list](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_8_hpcsizelist)
- [HB family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_8_hpc-hb-fam)
- [HC family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_8_hpc-hc-fam)
- [HX family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#tabpanel_8_hpc-hx-fam)

List of high performance computing optimized VM size families:

Expand table

| Family | Workloads | Series List |
| --- | --- | --- |
| [HB-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hb-family) | High memory bandwidth <br> Fluid Dynamics <br> Weather modeling | [HBv2-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hbv2-series)<br>[HBv3-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hbv3-series)<br>[HBv4-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hbv4-series)<br>[HBv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hbv5-series) |
| [HC-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hc-family) | High density compute <br> Finite element analysis <br> Molecular dynamics <br> Computational chemistry | [HC-series _(retiring May 31, 2027)_](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hc-series) |
| [HX-family](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hx-family) | Large memory capacity <br> Electronic Design Automation (EDA) | [HX-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hx-series) |

To learn more about a specific size family or series, select the tab for that family and scroll to find your desired size series.

Note

HC-series (Standard\_HC44rs, Standard\_HC44-16rs, Standard\_HC44-32rs) will be retired on May 31, 2027. After this date, remaining HC-series VMs will be deallocated, stop running, and will no longer have SLA or support. Sales of 1-year and 3-year Reserved Instances for HC-series ended on April 2, 2026. For new deployments, consider [HBv5-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hbv5-series) for higher performance and price-performance, or [HX-series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hx-series) for high-memory HPC workloads.

The 'HB' subfamily of VM size series are one of Azure's high-performance computing (HPC) optimized H-family VM instances. They're designed for compute-intensive workloads, such as computational fluid dynamics, finite element analysis, and large-scale scientific simulations. High-performance AMD EPYC processors and fast memory on HB-series VMs offer exceptional CPU and memory bandwidth, making them ideal for applications that require extensive computational resources to perform large-scale calculations and data processing. This feature makes them well suited for industries such as engineering, scientific research, and data analysis. In these fields, fast and accurate processing is essential for productivity and new ideas.

[View the full 'HB' family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hb-family)

**Computational Fluid Dynamics (CFD):** HB-family VMs are ideal for simulations in fields like aerospace, automotive design, and manufacturing, where fluid dynamics calculations are intensive.

**Finite Element Analysis (FEA):** HB-family VMs are suitable for engineering analyses that simulate physical phenomena, requiring intensive computational power to model complex systems and materials.

**Weather Forecasting:** HB-family VMs can handle the massive datasets and complex simulations required for high-resolution weather modeling and forecasting.

**Seismic Processing:** Used in the oil and gas industry, HB-family VMs can process seismic data to help map and understand subsurface structures.

**Scientific Research:** HB-family VMs support a wide range of scientific research that requires large-scale mathematical modeling, including physics and computational chemistry simulations.

**Genomics and Bioinformatics:** HB-family VMs are also used in life sciences for genomic analysis, where large amounts of data need to be processed quickly to decode genetic information.

The 'HC' family of VM size series are one of Azure's high-performance computing (HPC) optimized VM instances. They're designed for compute-intensive workloads that require substantial CPU power, such as genomic sequencing, engineering simulations, and financial modeling. High-performance Intel Xeon Scalable processors and fast memory on HC-series VMs offer exceptional computational capabilities and memory bandwidth, making them ideal for applications that demand intense processing power to handle complex calculations and massive data sets efficiently. These VMs are designed for sectors like healthcare, finance, and engineering, where rapid data processing and simulation accuracy are critical for advanced research and development.

[View the full HC family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hc-family)

**Genomic Sequencing:** HC-series VMs provide the computational power needed for genomic sequencing, enabling researchers to process and analyze large genetic datasets quickly.

**Engineering Simulations:** Ideal for running complex simulations in fields such as automotive, aerospace, and mechanical engineering. These simulations often include finite element analysis (FEA) and computational fluid dynamics (CFD).

**Financial Modeling:** These VMs can handle the high demands of financial applications, including risk analysis and quantitative simulations, which require massive computational resources to execute many calculations quickly.

**Scientific Research:** HC-series VMs support a wide range of scientific computing needs, particularly in physics and chemistry, where large-scale computations and data analysis are crucial.

**Weather Forecasting and Climate Simulation:** They're used in meteorology for high-resolution weather modeling and climate simulations, which require processing large datasets and performing complex simulations.

Note

Sales of 1-year and 3-year Reserved Instances for HC-series ended on April 2, 2026. HC-series is scheduled for retirement on May 31, 2027. Plan capacity accordingly.

The 'HX' family of VM size series are one of Azure's high-memory, high-performance computing (HPC) optimized VM instances. They're designed for memory-intensive workloads that require both large amounts of RAM and significant CPU performance, such as in-memory databases, big data analytics, and complex scientific simulations. Expansive memory and powerful CPUs on HX-series VMs provide the necessary resources to efficiently handle large datasets and perform rapid data processing. These VMs are designed for sectors like financial services, scientific research, and enterprise resource planning, where managing and analyzing large volumes of data in real-time is crucial for operational success and innovation.

[View the full HX family page](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/high-performance-compute/hx-family)

**In-Memory Databases:** HX-series VMs are excellent for hosting in-memory databases, which require extensive memory to maintain large datasets in RAM for ultra-fast processing and access.

**Big Data Analytics:** They can handle big data analytics applications that need to process vast amounts of data in memory to speed up analysis, which is critical for real-time decision-making.

**Genomic Research:** Genomics research often involves large-scale data analysis, where high memory capacity can significantly enhance performance by allowing more of the dataset to be held in memory, speeding up the analysis.

**Financial Simulations:** Financial institutions use HX-series VMs for high-frequency trading platforms and risk management simulations that require rapid processing of large data volumes to predict stock trends or calculate credit risks in real time.

**ERP Systems:** Large enterprise resource planning (ERP) systems benefit from the high memory and processing power of HX-series VMs to manage and process extensive enterprise data and support large numbers of concurrent users effectively.

[Section titled: List available machine sizes by region.](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#list-available-machine-sizes-by-region)

### List available machine sizes by region.

The Azure CLI can be leveraged to identify which machine sizes are available for a particular region using the command:

Copy

```
az vm list-skus --location <region> --output table
```

[Section titled: Learn platform sizes content](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#learn-platform-sizes-content)

## Learn platform sizes content

- For information about pricing of the various sizes, see the pricing pages for [Linux](https://azure.microsoft.com/pricing/details/virtual-machines/#Linux) or [Windows](https://azure.microsoft.com/pricing/details/virtual-machines/Windows/#Windows).
- Want to change the size of your VM? See [Change the size of a VM](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/resize-vm).
- For availability of VM sizes in Azure regions, see [Products available by region](https://azure.microsoft.com/regions/services/).
- To see general limits on Azure VMs, see [Azure subscription and service limits, quotas, and constraints](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits).
- For more information on how Azure names its VMs, see [Azure virtual machine sizes naming conventions](https://learn.microsoft.com/en-us/azure/virtual-machines/vm-naming-conventions).

[Section titled: REST API](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#rest-api)

## REST API

For information on using the REST API to query for VM sizes, see the following:

- [List available virtual machine sizes for resizing](https://learn.microsoft.com/en-us/rest/api/compute/virtualmachines/listavailablesizes)
- [List available virtual machine sizes for a subscription](https://learn.microsoft.com/en-us/rest/api/compute/resourceskus/list)
- [List available virtual machine sizes in an availability set](https://learn.microsoft.com/en-us/rest/api/compute/availabilitysets/listavailablesizes)

[Section titled: Benchmark scores](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#benchmark-scores)

## Benchmark scores

Learn more about compute performance for Linux VMs using the [CoreMark benchmark scores](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/compute-benchmark-scores).

Learn more about compute performance for Windows VMs using the [SPECInt benchmark scores](https://learn.microsoft.com/en-us/azure/virtual-machines/windows/compute-benchmark-scores).

[Section titled: Other size information](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#other-size-information)

## Other size information

List of all available sizes: [Sizes](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes)

Pricing Calculator: [Pricing Calculator](https://azure.microsoft.com/pricing/calculator/)

Information on Disk Types: [Disk Types](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types)

[Section titled: Next steps](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#next-steps)

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

- Last updated on 03/09/2026

Ask Learn is an AI assistant that can answer questions, clarify concepts, and define terms using trusted Microsoft documentation.

Please sign in to use Ask Learn.

[Sign in](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview?tabs=breakdownseries%2Cgeneralsizelist%2Ccomputesizelist%2Cmemorysizelist%2Cstoragesizelist%2Cgpusizelist%2Cfpgasizelist%2Chpcsizelist#)