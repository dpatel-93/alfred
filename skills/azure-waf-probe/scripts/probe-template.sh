# Probe set for azure-waf-probe. __TARGET__ is substituted by run-waf-probe.sh.
# Runs inside the throwaway container (POSIX sh). Payloads are inert signature strings.
echo "=== WAF simulation $(date -u) ==="
printf 'SOURCE_IP='; curl -s https://api.ipify.org; echo
probe() { name="$1"; shift; printf '%-14s %s\n' "$name" "$(curl -sL --post301 --post302 -o /dev/null -w 'HTTP %{http_code}  final=%{url_effective}' "$@")"; }
probe baseline      '__TARGET__/?wafsim=baseline'
probe sqli          "__TARGET__/?wafsim=sqli&id=1'%20OR%20'1'='1"
probe xss           '__TARGET__/?wafsim=xss&q=<script>alert(1)</script>'
probe traversal     '__TARGET__/?wafsim=traversal&file=../../../../etc/passwd'
probe cmd_injection '__TARGET__/?wafsim=cmd&cmd=;cat%20/etc/passwd'
probe log4shell     -A '${jndi:ldap://127.0.0.1/a}' '__TARGET__/?wafsim=log4shell'
probe brotli_ce     -A 'WAFSIM-BROTLI-CVE-2025-6176' -X POST -H 'Content-Encoding: br' -H 'Content-Type: application/json' -d '{"test": "data"}' '__TARGET__/?wafsim=brotli-ce'
echo "=== done ==="
