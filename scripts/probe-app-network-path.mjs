// Read-only: the outbound path of caliber-mis-783's app. The app sends all traffic through its virtual network
// (vnetRouteAllEnabled), and on 15 Nov 2026 it could not reach api.telegram.org (15 s timeout) while Google worked
// and the deployment host (outside that network path) reached Telegram in 0.2 s. This prints the subnet's outbound
// security rules, its routes and whether it has a NAT gateway. It changes nothing. Private next-hop addresses are
// masked because the log is public.
import {execFileSync} from 'node:child_process';

const az = args => { try { return JSON.parse(execFileSync('az', [...args, '-o', 'json'], {encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe']}) || 'null'); } catch (error) { return {error: String(error?.stderr || error?.message || error).split('\n')[0].slice(0, 200)}; } };
const mask = value => String(value ?? '').replace(/\b(10|172|192)\.\d+\.\d+\.\d+\b/g, '<private ip>');
const last = id => String(id || '').split('/').pop() || 'none';

const site = az(['webapp', 'show', '-g', 'coalmine-fleet-maintenance-rg', '-n', 'caliber-mis-783']);
const subnetId = site?.virtualNetworkSubnetId;
console.log('route all traffic through the network:', site?.vnetRouteAllEnabled ?? site?.siteConfig?.vnetRouteAllEnabled);
if (!subnetId) { console.log('The app is not joined to a subnet.'); process.exit(0); }
const subnet = az(['network', 'vnet', 'subnet', 'show', '--ids', subnetId]);
console.log('subnet:', last(subnetId), '| network security group:', last(subnet?.networkSecurityGroup?.id), '| route table:', last(subnet?.routeTable?.id), '| NAT gateway:', last(subnet?.natGateway?.id), '| default outbound access:', subnet?.defaultOutboundAccess ?? 'not given');
console.log('service endpoints:', (subnet?.serviceEndpoints || []).map(e => e.service).join(', ') || 'none');

if (subnet?.networkSecurityGroup?.id) {
  const nsg = az(['network', 'nsg', 'show', '--ids', subnet.networkSecurityGroup.id]);
  console.log('\noutbound security rules (lowest priority number wins):');
  for (const rule of [...(nsg?.securityRules || []), ...(nsg?.defaultSecurityRules || [])].filter(r => r.direction === 'Outbound').sort((a, b) => a.priority - b.priority)) {
    const to = mask([rule.destinationAddressPrefix, ...(rule.destinationAddressPrefixes || [])].filter(Boolean).join(','));
    const ports = [rule.destinationPortRange, ...(rule.destinationPortRanges || [])].filter(Boolean).join(',');
    console.log(`  ${rule.priority} ${rule.access} ${rule.protocol} to ${to} ports ${ports} (${rule.name})`);
  }
}
if (subnet?.routeTable?.id) {
  const table = az(['network', 'route-table', 'show', '--ids', subnet.routeTable.id]);
  console.log('\nroutes:');
  for (const route of table?.routes || []) console.log(`  ${mask(route.addressPrefix)} -> ${route.nextHopType}${route.nextHopIpAddress ? ' ' + mask(route.nextHopIpAddress) : ''} (${route.name})`);
}
if (subnet?.natGateway?.id) {
  const nat = az(['network', 'nat', 'gateway', 'show', '--ids', subnet.natGateway.id]);
  console.log('\nNAT gateway:', last(subnet.natGateway.id), '| public IPs:', (nat?.publicIpAddresses || []).length, '| idle timeout min:', nat?.idleTimeoutInMinutes, '| state:', nat?.provisioningState);
}
