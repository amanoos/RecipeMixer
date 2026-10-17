import net from 'node:net';

/**
 * Decides whether an IP address is a public, globally routable one.
 * Used by the URL-import fetcher: anything that is not clearly public is refused (fail closed).
 */

const BLOCKED_V4 = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['168.63.129.16', 32], // Azure's internal host service, reached from inside Azure VMs although it looks public
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24], // AS112 (special-purpose DNS)
  ['192.52.193.0', 24], // AS112
  ['192.175.48.0', 24], // AS112
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_V4.addSubnet(network, prefix, 'ipv4');
}

// IPv6: only global unicast (2000::/3) is allowed, minus ranges that are reserved or embed other addresses.
const GLOBAL_UNICAST_V6 = new net.BlockList();
GLOBAL_UNICAST_V6.addSubnet('2000::', 3, 'ipv6');

const BLOCKED_V6 = new net.BlockList();
for (const [network, prefix] of [
  ['2001::', 23], // IETF protocol assignments: Teredo, TURN/PCP anycast, AMT, AS112, ORCHID
  ['2620:4f:8000::', 48], // AS112 (IPv6)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds an IPv4 address)
  ['3fff::', 20], // documentation
] as const) {
  BLOCKED_V6.addSubnet(network, prefix, 'ipv6');
}

const MAPPED_DOTTED = /^(?:0{1,4}:){5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$|^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;
const MAPPED_HEX = /^(?:0{1,4}:){5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$|^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/** Returns the embedded IPv4 address of an IPv4-mapped IPv6 address (::ffff:a.b.c.d or ::ffff:hhhh:hhhh), else null. */
function unwrapMappedV4(ip: string): string | null {
  const lower = ip.toLowerCase();

  const dotted = MAPPED_DOTTED.exec(lower);
  const dottedAddress = dotted?.[1] ?? dotted?.[2];
  if (dottedAddress) return dottedAddress;

  const hex = MAPPED_HEX.exec(lower);
  const highText = hex?.[1] ?? hex?.[3];
  const lowText = hex?.[2] ?? hex?.[4];
  if (highText && lowText) {
    const high = Number.parseInt(highText, 16);
    const low = Number.parseInt(lowText, 16);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return null;
}

export function isPublicAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return !BLOCKED_V4.check(ip, 'ipv4');
  if (version !== 6) return false;

  const mapped = unwrapMappedV4(ip);
  if (mapped !== null) return net.isIPv4(mapped) && !BLOCKED_V4.check(mapped, 'ipv4');

  return GLOBAL_UNICAST_V6.check(ip, 'ipv6') && !BLOCKED_V6.check(ip, 'ipv6');
}
