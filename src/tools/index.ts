/**
 * Re-exports all tool registration functions.
 * Each RouterOS section module registers its own tools.
 */

export { registerAdminTools } from './admin.js';
export { registerBridgeTools } from './bridge.js';
export { registerCertificateTools } from './certificates.js';
export { registerDhcpDnsTools } from './dhcp-dns.js';
export { registerDiagnosticTools } from './diagnostics.js';
export { registerFirewallTools } from './firewall.js';
export { registerHealthTools } from './health.js';
export { registerInterfaceTools } from './interfaces.js';
export { registerIpTools } from './ip.js';
export { registerLogTools } from './log.js';
export { registerNoteTools } from './note.js';
export { registerPackageTools } from './packages.js';
export { registerPppUserTools } from './ppp-user.js';
export { registerSetupTools } from './setup.js';
export { registerSystemTools } from './system.js';
