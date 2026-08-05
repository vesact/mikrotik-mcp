/**
 * Re-exports all tool registration functions.
 * Each RouterOS section module registers its own tools.
 */

export { registerSystemTools } from './system.js';
export { registerHealthTools } from './health.js';
export { registerPackageTools } from './packages.js';
export { registerNoteTools } from './note.js';
export { registerLogTools } from './log.js';
export { registerCertificateTools } from './certificates.js';
export { registerInterfaceTools } from './interfaces.js';
export { registerBridgeTools } from './bridge.js';
export { registerIpTools } from './ip.js';
export { registerFirewallTools } from './firewall.js';
export { registerDhcpDnsTools } from './dhcp-dns.js';
export { registerPppUserTools } from './ppp-user.js';
export { registerAdminTools } from './admin.js';
export { registerDiagnosticTools } from './diagnostics.js';
export { registerSetupTools } from './setup.js';
