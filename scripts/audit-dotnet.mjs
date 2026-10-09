import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dotnetCommand } from './dotnet-command.mjs';

const result = spawnSync(dotnetCommand(), ['list', 'coordinator-dotnet', 'package', '--vulnerable', '--include-transitive', '--format', 'json'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
  timeout: 60_000,
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
});
if (result.error || result.status !== 0) {
  console.error('The .NET dependency audit could not complete.');
  process.exit(1);
}
const report = JSON.parse(result.stdout);
if (report.version !== 1 || !Array.isArray(report.projects) || report.projects.length !== 1) {
  throw new Error('Unexpected .NET audit report; inspect the dependency audit before proceeding.');
}
let findings = 0;
for (const project of report.projects) {
  for (const framework of project.frameworks ?? []) {
    for (const dependency of [...(framework.topLevelPackages ?? []), ...(framework.transitivePackages ?? [])]) {
      for (const vulnerability of dependency.vulnerabilities ?? []) {
        findings++;
        console.error(`${dependency.id} ${dependency.resolvedVersion}: ${vulnerability.severity} ${vulnerability.advisoryurl}`);
      }
    }
  }
}
if (findings) process.exit(1);
console.log('Locked .NET direct and transitive dependencies: no reported vulnerabilities.');
