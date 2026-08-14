Table of contents Exit editor mode

Ask LearnAsk Learn

Reading modeTable of contents[Read in English](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans)Add to CollectionsAdd to plan[Edit](https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/app-service/overview-hosting-plans.md)

* * *

Copy MarkdownPrint

* * *

Note

Access to this page requires authorization. You can try [signing in](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#) or changing directories.


Access to this page requires authorization. You can try changing directories.


# What are Azure App Service plans?

Feedback

Summarize this article for me


An _Azure App Service plan_ defines a set of compute resources for a web app to run. An app service always runs in an App Service plan. [Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/dedicated-plan) also has the option of running in an App Service plan.

When you create an App Service plan in a certain region, you create a set of compute resources for that plan in that region. Whatever apps you put into the App Service plan run on those compute resources, as defined in the plan.

Important

Managed Instance is in preview, available for Windows web apps in select regions, and limited to Pv4 and Pmv4 [pricing plans](https://azure.microsoft.com/pricing/calculator/). More regions to follow. Linux and containers aren't supported.

Each App Service plan defines:

- Operating system (Windows, Linux)
- Region (West US, East US, and so on)
- Number of virtual machine (VM) instances
- Size of VM instances (small, medium, large)
- Pricing tier (Free, Shared, Basic, Standard, Premium, PremiumV2, PremiumV3, PremiumV4 IsolatedV2)

[Section titled: Pricing tiers](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#pricing-tiers)

## Pricing tiers

The pricing tier of an App Service plan determines what App Service features you get and how much you pay for the plan. The pricing tiers available to your App Service plan depend on the operating system that you select when you create it. This table shows the categories of pricing tiers:

Expand table

| Category | Tiers | Description |
| --- | --- | --- |
| Shared compute | Free, Shared | Free and Shared, the two base tiers, run an app on the same Azure VM as other App Service apps, including apps of other customers. These tiers allocate CPU quotas to each app that runs on the shared resources. The resources can't scale out. These tiers are intended for only development and testing purposes. |
| Dedicated compute | Basic, Standard, Premium, PremiumV2, PremiumV3, PremiumV4 | The Basic, Standard, Premium, PremiumV2, PremiumV3, and PremiumV4 tiers run apps on dedicated Azure VMs. Only apps in the same App Service plan share the same compute resources (and those resources aren't shared with other customers). The higher the tier, the more VM instances that are available to you for scale-out. |
| Isolated | IsolatedV2 | The IsolatedV2 tier runs dedicated Azure VMs on dedicated Azure virtual networks. This tier provides network isolation on top of compute isolation to your apps. It provides the maximum scale-out capabilities. |

Each tier also provides a specific subset of App Service features. These features include custom domains and TLS/SSL certificates, autoscaling, deployment slots, backups, Azure Traffic Manager integration, and more. The higher the tier, the more features that are available. To find out which features are supported in each pricing tier, see the [App Service plan details](https://azure.microsoft.com/pricing/details/app-service/windows/#pricing).

You can find more comparisons of plans in [App Service limits](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#azure-app-service-limits).

For pricing information, see [App Service pricing](https://azure.microsoft.com/pricing/details/app-service/).

[Section titled: Considerations for running and scaling an app](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#considerations-for-running-and-scaling-an-app)

## Considerations for running and scaling an app

In the Free and Shared tiers, an app receives CPU minutes on a shared VM instance and can't scale out.

In other tiers, an app runs and scales as follows:

- If you create an app in App Service, it's part of an App Service plan. When the app runs, it runs on all the VM instances configured in the App Service plan.
- If multiple apps are in the same App Service plan, they all share the same VM instances.
- If you have multiple deployment slots for an app, all deployment slots also run on the same VM instances.
- If you enable diagnostic logs, perform backups, or run [WebJobs](https://learn.microsoft.com/en-us/azure/app-service/webjobs-create), they also use CPU cycles and memory on these VM instances.
- All apps in an App Service plan scale together, because they share the same underlying compute resources (VM instances). Scaling the plan — whether manually or through autoscale rules — affects all apps in the plan.

For more information on scaling out an app, see [Get started with autoscale in Azure](https://learn.microsoft.com/en-us/azure/azure-monitor/autoscale/autoscale-get-started).

[Section titled: Cost of App Service plans](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#cost-of-app-service-plans)

## Cost of App Service plans

This section describes how App Service apps are billed. For detailed, region-specific pricing information, see [App Service pricing](https://azure.microsoft.com/pricing/details/app-service/).

Except for the Free tier, an App Service plan carries a charge on the compute resources that it uses:

- **Shared tier**: Each app receives a quota of CPU minutes, so _each app_ is charged for the CPU quota.
- **Dedicated compute tiers (Basic, Standard, Premium, PremiumV2, PremiumV3, PremiumV4)**: The App Service plan defines the number of VM instances that the apps are scaled to, so _each VM instance_ in the App Service plan is charged. These VM instances are charged the same, regardless of how many apps are running on them. To avoid unexpected charges, see [Delete an App Service plan](https://learn.microsoft.com/en-us/azure/app-service/app-service-plan-manage#delete-an-app-service-plan).

Note

In dedicated compute tiers, the VM resources are **dedicated to your App Service plan and are not shared with other customers**.

However, **any apps you place inside the same App Service plan share those dedicated resources with each other**.

This means compute is dedicated at the **plan level**, not the **per-app level**.

To isolate compute per app, create a separate App Service plan.

- **IsolatedV2 tier**: The App Service Environment defines the number of isolated workers that run your apps, and _each worker_ is charged.

You aren't charged for using the App Service features that are available to you. These features include configuring custom domains, TLS/SSL certificates, deployment slots, and backups. The exceptions are:

- **App Service domains**: You pay when you purchase one in Azure and when you renew it each year.
- **App Service certificates**: You pay when you purchase one in Azure and when you renew it each year.
- **IP-based TLS connections**: There's an hourly charge for each IP-based TLS connection, but some Standard or higher tiers give you one IP-based TLS connection for free. Server Name Indication (SNI)-based TLS connections are free.

If you integrate App Service with another Azure service, you might need to consider charges from that service. For example, if you use Azure Traffic Manager to scale your app geographically, Traffic Manager also charges you based on your usage. To estimate your cross-services cost in Azure, see [Pricing calculator](https://azure.microsoft.com/pricing/calculator/).

Tip

Azure services cost money. To help control spending, you can use Microsoft Cost Management to set budgets and configure alerts.

You can analyze, manage, and optimize your Azure costs by using Cost Management. To learn more, see the [quickstart on analyzing your costs](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/quick-acm-cost-analysis?WT.mc_id=costmanagementcontent_docsacmhorizontal_-inproduct-learn).

[Section titled: Scaling for capabilities or features](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#-scaling-for-capabilities-or-features)

## Scaling for capabilities or features

You can scale your App Service plan up or down at any time. It's as simple as changing the pricing tier of the plan. You can choose a lower pricing tier at first, and then scale up later when you need more App Service features.

For example, you can start testing your web app in a Free-tier App Service plan and pay nothing. When you add your [custom DNS name](https://learn.microsoft.com/en-us/azure/app-service/app-service-web-tutorial-custom-domain) to the web app, just scale your plan up to the Shared tier. Later, when you want to [create a TLS binding](https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-bindings), scale your plan up to the Basic tier. When you want to have [staging environments](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots), scale up to the Standard tier. When you need more cores, memory, or storage, scale up to a bigger VM size in the same tier.

The same process works in reverse. When you no longer need the capabilities or features of a higher tier, you can scale down to a lower tier and save money.

For more information on scaling up an App Service plan, see [Scale up an app in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/manage-scale-up).

If your app is in the same App Service plan with other apps, you might want to improve the app's performance by isolating the compute resources. You can isolate the resources by [moving the app to a separate App Service plan](https://learn.microsoft.com/en-us/azure/app-service/app-service-plan-manage#move-an-app-to-another-app-service-plan).

[Section titled: Decision to use a new plan or an existing plan for an app](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#decision-to-use-a-new-plan-or-an-existing-plan-for-an-app)

## Decision to use a new plan or an existing plan for an app

You pay for the computing resources that your App Service plan allocates as described in the [earlier section about cost](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#cost). You can potentially save money by putting multiple apps into one App Service plan. You can continue to add apps to an existing plan as long as the plan has enough resources to handle the load.

However, keep in mind that apps in the same App Service plan all share the same compute resources. To determine whether the new app has the necessary resources, you need to understand the capacity of the existing App Service plan, along with the expected load for the new app. Overloading an App Service plan can cause downtime for your new and existing apps. You can find more comparisons between plans at [App Service limits](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#azure-app-service-limits).

Isolate your app in a new App Service plan when:

- The app is resource intensive. For general guidance, use this table:

Expand table




| App Service plan | Maximum apps |
| --- | --- |
| B1, S1, P1v2, I1v1 | 8 |
| B2, S2, P2v2, I2v1 | 16 |
| B3, S3, P3v2, I3v1 | 32 |
| P0v3, P0v4 | 8 |
| P1v3, P1v4, I1v2 | 16 |
| P2v3, P2v4, I2v2, P1mv3, P1mv4 | 32 |
| P3v3, P3v4, I3v2, P2mv3 | 64 |
| I4v2, I5v2, I6v2 | Maximum density bound by vCPU usage |
| P3mv3, P3mv4, P4mv3, P4mv4, P5mv3, P5mv4 | Maximum density bound by vCPU usage |

- You want to scale the app independently from the other apps in the existing plan.

- The app needs resources in a different geographical region. This way, you can allocate a new set of resources for your app and gain greater control of your apps.


Note

An active slot is also classified as an active app because it's competing for resources in the same App Service plan.

[Section titled: Managed Instance on Azure App Service (preview)](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#managed-instance-on-azure-app-service-preview)

## Managed Instance on Azure App Service (preview)

Managed Instance is a plan-scoped hosting option for Windows web apps that require operating system customization, optional private networking, and legacy Windows component support. It's designed for "lift and improve" migrations of infrastructure-dependent workloads that need COM components, registry access, MSI installers, or IIS customization while retaining App Service's managed platform features.

Key features:

- PowerShell configuration scripts for persistent OS and middleware setup
- Plan-level virtual network integration with private DNS
- Azure Key Vault-backed registry adapters for secure configuration
- Storage mounts (Azure Files, UNC paths, local temporary storage)
- Just-in-time RDP access via Azure Bastion for diagnostics
- Plan-level managed identities for infrastructure authentication
- Pre-installed .NET Framework (3.5, 4.8) and .NET 8 with support for custom runtimes
- Best for: Legacy .NET Framework apps requiring Windows-specific dependencies, gradual modernization without complete rewrites, and plan-level network isolation for compliance.

Current limitations (preview): Windows only, Pv4/Pmv4 SKUs, available in East Asia, West Central US, North Europe, and East US. Not available for Linux, containers, or in App Service Environment.

[Learn more about Managed Instance](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-instance)

[Section titled: Related content](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#related-content)

## Related content

- [Manage an App Service plan](https://learn.microsoft.com/en-us/azure/app-service/app-service-plan-manage)

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


Module


[Configure Azure App Service Plans - Training](https://learn.microsoft.com/en-us/training/modules/configure-app-service-plans/?source=recommendations)

Configure Azure App Service plans


Certification


[Microsoft Certified: Azure Developer Associate - Certifications](https://learn.microsoft.com/en-us/credentials/certifications/azure-developer/?source=recommendations)

Build end-to-end solutions in Microsoft Azure to create Azure Functions, implement and manage web apps, develop solutions utilizing Azure storage, and more.


Events


[AI Apps & Agents Dev Days](https://aka.ms/AIAppsandAgentsLearn)

Apr 29, 3 PM - Apr 29, 3 PM


Experiment with what's next in AI-driven apps and agent design


[Register now](https://aka.ms/AIAppsandAgentsLearn)

* * *

- Last updated on 11/18/2025

Ask Learn is an AI assistant that can answer questions, clarify concepts, and define terms using trusted Microsoft documentation.

Please sign in to use Ask Learn.

[Sign in](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans#)