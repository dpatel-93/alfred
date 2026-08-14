Table of contents Exit editor mode

Ask LearnAsk Learn

Reading modeTable of contents[Read in English](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal)Add to CollectionsAdd to plan[Edit](https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/app-service/configure-zone-redundancy.md)

* * *

Copy MarkdownPrint

* * *

Note

Access to this page requires authorization. You can try [signing in](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#) or changing directories.


Access to this page requires authorization. You can try changing directories.


# Configure App Service plans for zone redundancy

Feedback

Summarize this article for me


Azure App Service provides built-in reliability features to help ensure that your applications remain available and resilient. This article describes how to create an App Service plan that includes zone redundancy. It also covers how to disable and enable zone redundancy on existing plans and how to check for zone redundancy support. For more information about zone redundancy, see [Reliability in App Service](https://learn.microsoft.com/en-us/azure/reliability/reliability-app-service).

[Section titled: Create a new zone-redundant App Service plan](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#create-a-new-zone-redundant-app-service-plan)

## Create a new zone-redundant App Service plan

To create a new App Service plan that includes zone redundancy, follow the appropriate steps.

- [Azure portal](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_1_portal)
- [Azure CLI](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_1_azurecli)
- [Bicep](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_1_bicep)

Follow the guidance to [create an App Service plan](https://learn.microsoft.com/en-us/azure/app-service/app-service-plan-manage#create-an-app-service-plan). Make sure to select **Enabled** for **Zone redundancy**.

![Screenshot of zone redundancy enablement during App Service plan creation in the Azure portal.](https://learn.microsoft.com/en-us/azure/app-service/media/configure-zone-redundancy/app-service-create-zr-plan.png)

- Set the `--zone-redundant` argument.
- Set the `--number-of-workers` argument, which is the number of instances, to a value of 2 or more.

Azure CLI


Copy

```azurecli
az appservice plan create \
    -n <app-service-plan-name> \
    -g <resource-group-name> \
    --zone-redundant \
    --number-of-workers 2 \
    --sku P1V3
```

- Set the `zoneRedundant` property to `true`.
- Set the `sku.capacity` property to a value of 2 or more. If you don't define the `sku.capacity` property, the value defaults to 1.

Bicep


Copy

```bicep
resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' = {
    name: appServicePlanName
    location: location
    sku: {
        name: sku
        capacity: 2
    }
    kind: 'linux'
    properties: {
        reserved: true
        zoneRedundant: true
    }
}
```

[Section titled: Set zone redundancy for an existing App Service plan](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#set-zone-redundancy-for-an-existing-app-service-plan)

## Set zone redundancy for an existing App Service plan

1. To enable zone redundancy on an existing App Service plan, [check for zone redundancy support](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#check-for-zone-redundancy-support-on-an-app-service-plan).

2. **If your App Service plan supports zone redundancy,** use the Azure portal, the Azure CLI, or Bicep and Azure Resource Manager to enable or disable it.



   - [Azure portal](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_2_portal)
   - [Azure CLI](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_2_azurecli)
   - [Bicep](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_2_bicep)

1. In the [Azure portal](https://portal.azure.com/), go to your App Service plan.

2. Select **Settings** \> **Scale out (App Service plan)** in the left navigation pane.

3. Select **Zone Redundancy** to enable zone redundancy. Deselect it to disable it.

      The zone redundancy status of an App Service plan changes almost instantaneously. No downtime or performance problems occur during the process.

      ![Screenshot of zone redundancy property for an App Service plan in the Azure portal.](https://learn.microsoft.com/en-us/azure/app-service/media/configure-zone-redundancy/app-service-plan-zone-redundancy-portal.png)


Important

If you have _Rules Based_ scaling enabled, you can't use the Azure portal to enable zone redundancy. You must use the Azure CLI or Bicep and Resource Manager instead.

   - To _enable zone redundancy_, set the `zoneRedundant` property to `true`.

   - Set the `sku.capacity` argument, which is the number of instances, to a value of 2 or more.


      Azure CLI


     Copy




     ```azurecli
     az appservice plan update \
        -n <app-service-plan-name> \
        -g <resource-group-name> \
        --set zoneRedundant=true sku.capacity=2
     ```

   - To _disable zone redundancy_, set the `zoneRedundant` property to `false`.


      Azure CLI


     Copy




     ```azurecli
     az appservice plan update \
        -n <app-service-plan-name> \
        -g <resource-group-name> \
        --set zoneRedundant=false
     ```


   - To _enable zone redundancy_, set the `zoneRedundant` property to `true`.

   - Set the `sku.capacity` property to a value of 2 or more. If you don't define the `sku.capacity` property, the value defaults to 1.


      Bicep


     Copy




     ```bicep
     resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' = {
         name: appServicePlanName
         location: location
         sku: {
             name: sku
             capacity: 2
         }
         kind: 'linux'
         properties: {
             reserved: true
             zoneRedundant: true
         }
     }
     ```

   - To _disable zone redundancy_, set the `zoneRedundant` property to `false`.


3. **If your App Service plan is on a scale unit that doesn't support zone redundancy,** you can't enable zone redundancy on your plan. Instead, you need to [redeploy your apps to a new plan on a different scale unit](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/app-service-move-limitations).


[Section titled: Check for zone redundancy support on an App Service plan](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#check-for-zone-redundancy-support-on-an-app-service-plan)

## Check for zone redundancy support on an App Service plan

To check whether an existing App Service plan supports zone redundancy, do the following steps:

1. Determine the maximum number of availability zones that the App Service plan supports by using the Azure portal, the Azure CLI, or Bicep and Resource Manager.



   - [Azure portal](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_3_portal)
   - [Azure CLI](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_3_azurecli)
   - [Bicep](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_3_bicep)

1. In the [Azure portal](https://portal.azure.com/), go to your App Service plan.

2. Select **Scale out (App Service plan)**.

      **Maximum available zones** shows the maximum number of zones that your App Service plan can use.

      ![Screenshot of the maximum available zones property in the scale-out section in the Azure portal for an App Service plan.](https://learn.microsoft.com/en-us/azure/app-service/media/configure-zone-redundancy/app-service-plan-max-zones-portal.png)


Query the plan's `maximumNumberOfZones` property.

Azure CLI


Copy

```azurecli
az appservice plan show \
    -n <app-service-plan-name> \
    -g <resource-group-name> \
    --query properties.maximumNumberOfZones
```

Query the plan's `maximumNumberOfZones` property.

Bicep


Copy

```bicep
resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' existing = {
    name: '<app-service-plan-name>'
}

#disable-next-line BCP083
output maximumNumberOfZones int = appServicePlan.properties.maximumNumberOfZones
```

2. Compare the number with the following table to determine whether your plan supports zone redundancy.

Expand table




| Maximum number of zones | Zone redundancy support |
| --- | --- |
| More than 1 | Supported |
| Equal to 1 | Not supported\* |



\\* If you use a plan or a stamp that doesn't support availability zones, you must create a new App Service plan in a new resource group. This setup ensures that your deployment lands on App Service infrastructure that supports availability zones.


[Section titled: View physical zones for an App Service plan](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#view-physical-zones-for-an-app-service-plan)

## View physical zones for an App Service plan

When you have a zone-redundant App Service plan, the platform automatically places the instances across [physical availability zones](https://learn.microsoft.com/en-us/azure/reliability/availability-zones-overview#physical-and-logical-availability-zones). To verify that your instances are spread across zones, use the Azure portal or the Azure CLI to check which physical availability zones your plan's instances use.

- [Azure portal](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_4_portal)
- [Azure CLI](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_4_azurecli)
- [Bicep](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#tabpanel_4_bicep)

1. In the [Azure portal](https://portal.azure.com/), go to your App Service app. If you have multiple apps in a plan, you can select any app.

2. Select **Health check**.

3. Select **Instances** to view the physical zone placement for each of your instances.

![Screenshot of the Instances tab in the Health Check section with the physical zone information in the Azure portal for an App Service app.](https://learn.microsoft.com/en-us/azure/app-service/media/configure-zone-redundancy/app-service-physical-zones.png)


Use the [REST API](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/get-instance-info), which returns the `physicalZone` value for each instance in the App Service plan.

Azure CLI


Copy

```azurecli
az rest --method get --url https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.Web/sites/{appName}/instances?api-version=2024-04-01
```

Bicep doesn't support this operation. Use the Azure CLI or the Azure portal instead.

[Section titled: Related content](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#related-content)

## Related content

- [Reliability in App Service](https://learn.microsoft.com/en-us/azure/reliability/reliability-app-service)
- [Configure an App Service Environment for zone redundancy](https://learn.microsoft.com/en-us/azure/app-service/environment/configure-zone-redundancy-environment)

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

Events


[AI Apps & Agents Dev Days](https://aka.ms/AIAppsandAgentsLearn)

Apr 30, 6 AM - Apr 30, 6 AM


Experiment with what's next in AI-driven apps and agent design


[Register now](https://aka.ms/AIAppsandAgentsLearn)

* * *

- Last updated on 10/28/2025

Ask Learn is an AI assistant that can answer questions, clarify concepts, and define terms using trusted Microsoft documentation.

Please sign in to use Ask Learn.

[Sign in](https://learn.microsoft.com/en-us/azure/app-service/configure-zone-redundancy?tabs=portal#)