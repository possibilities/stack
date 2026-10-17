import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { egressPolicy, type EgressPolicy } from "@stack/scrape/network";

export const researchPolicyId = (policy: EgressPolicy) => createHash("sha256").update(JSON.stringify(egressPolicy.parse(policy))).digest("hex");

/** Installed guest-wide before unprivileged Chrome. Only the image's root
 * management services may originate loopback CDP connections. */
export function researchFirewall(input: EgressPolicy): string {
  const policy = egressPolicy.parse(input);
  const commands = [
    "command -v iptables >/dev/null", "command -v ip6tables >/dev/null",
    // A missing IPv6 table does not establish that IPv6 is disabled. Only the
    // kernel's EAFNOSUPPORT answer permits omitting that family's firewall.
    `research_ipv6=$(python3 -c 'import errno,socket
try:
    with socket.socket(socket.AF_INET6,socket.SOCK_STREAM): pass
except OSError as error:
    if error.errno != errno.EAFNOSUPPORT: raise
    print(0)
else:
    print(1)')`,
    'case "$research_ipv6" in 0|1) ;; *) exit 1 ;; esac',
    'research_ip6tables() { if [ "$research_ipv6" = 1 ]; then command ip6tables "$@"; fi; }',
    "iptables -P OUTPUT DROP", "research_ip6tables -P OUTPUT DROP",
    "iptables -F OUTPUT", "research_ip6tables -F OUTPUT",
    "iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED --ctdir REPLY -j ACCEPT",
    "research_ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED --ctdir REPLY -j ACCEPT",
    "iptables -A OUTPUT -d 127.0.0.1 -p tcp --dport 9222 -m owner --uid-owner 0 -j ACCEPT",
    "iptables -A OUTPUT -d 127.0.0.1 -p tcp --dport 9223 -m owner --uid-owner 0 -j ACCEPT",
    "iptables -A OUTPUT -d 1.1.1.1 -p udp --dport 53 -j ACCEPT",
    "iptables -A OUTPUT -d 1.1.1.1 -p tcp --dport 53 -j ACCEPT",
  ];
  for (const destination of policy.privateDestinations) {
    commands.push(`${isIP(destination.address) === 4 ? "iptables" : "research_ip6tables"} -A OUTPUT -d ${destination.address} -p tcp --dport ${destination.port} -j ACCEPT`);
  }
  for (const range of ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
    "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"])
    commands.push(`iptables -A OUTPUT -d ${range} -j DROP`);
  for (const range of ["2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"])
    commands.push(`research_ip6tables -A OUTPUT -d ${range} -j DROP`);
  commands.push("iptables -A OUTPUT -p tcp -j ACCEPT", "research_ip6tables -A OUTPUT -d 2000::/3 -p tcp -j ACCEPT");
  return commands.join("; ");
}
