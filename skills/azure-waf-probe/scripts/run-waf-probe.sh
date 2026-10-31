#!/usr/bin/env bash
# run-waf-probe.sh — fire inert WAF attack probes at TARGET from a throwaway Azure
# Container Instance, print per-probe HTTP status + the container's egress IP, then
# optionally delete the throwaway resource group.
#
# Usage:   bash run-waf-probe.sh <https://target> [--delete]
# Env:     WAF_SIM_LOCATION (default eastus2), WAF_SIM_IMAGE (default mcr.microsoft.com/azure-cli:latest)
#
# Only run against a WAF you own or are explicitly authorized to test. Payloads are inert.
set -u

TARGET="${1:?Usage: run-waf-probe.sh <https://target> [--delete]}"
ACTION="${2:-}"
LOC="${WAF_SIM_LOCATION:-eastus2}"
IMAGE="${WAF_SIM_IMAGE:-mcr.microsoft.com/azure-cli:latest}"
RG="rg-waf-sim-$(date +%s)"
ACI="waf-sim"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Target: $TARGET"
echo "RG:     $RG  ($LOC)"

# --- provider + resource group ---
if [ "$(az provider show -n Microsoft.ContainerInstance --query registrationState -o tsv 2>/dev/null)" != "Registered" ]; then
  echo "Registering Microsoft.ContainerInstance (one-time, may take a minute)..."
  az provider register -n Microsoft.ContainerInstance --wait
fi
az group create -n "$RG" -l "$LOC" -o none

# --- build probe script with the target substituted, base64 for safe transport ---
B64=$(sed "s#__TARGET__#${TARGET%/}#g" "$HERE/probe-template.sh" | base64 -w0)

# --- one-shot container ---
echo "Deploying one-shot container (image pull can take a minute)..."
az container create -g "$RG" -n "$ACI" -l "$LOC" --image "$IMAGE" --os-type Linux \
  --restart-policy Never --cpu 1 --memory 1.5 \
  --command-line "bash -c \"echo $B64 | base64 -d | bash\"" -o none

# --- wait for it to finish, then show output ---
for i in $(seq 1 60); do
  st=$(az container show -g "$RG" -n "$ACI" --query "containers[0].instanceView.currentState.state" -o tsv 2>/dev/null)
  [ "$st" = "Terminated" ] && break
  sleep 6
done

echo "----- probe results -----"
az container logs -g "$RG" -n "$ACI"
echo "-------------------------"

# --- teardown ---
if [ "$ACTION" = "--delete" ]; then
  echo "Deleting $RG..."
  az group delete -n "$RG" --yes --no-wait
  echo "Delete queued for $RG."
else
  echo "Left $RG in place for re-runs. Delete it with:"
  echo "  az group delete -n $RG --yes"
fi
