import { spawn } from 'node:child_process';
import { dotnetCommand } from './dotnet-command.mjs';

const child = spawn(dotnetCommand(), process.argv.slice(2), { stdio: 'inherit', env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' } });
child.on('error', () => { console.error('Install the .NET SDK from global.json, or set DOTNET_COMMAND to its executable.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
