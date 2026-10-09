import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Respect an installed SDK or an explicit command; the isolated local fallback
// avoids modifying the user's global SDK configuration during this migration.
export function dotnetCommand() {
  const local = path.join(homedir(), '.local', 'share', 'relaylab-dotnet', 'dotnet');
  return process.env.DOTNET_COMMAND ?? (existsSync(local) ? local : 'dotnet');
}
