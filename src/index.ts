import * as core from '@actions/core';
import { exec as rawExec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(rawExec);

async function run(): Promise<void> {
  try {
    // Inputs
    const appleCertBase64 = core.getInput('apple-certificate', { required: true });
    const appleCertPassword = core.getInput('apple-certificate-password', { required: true });
    const identityPrefix = core.getInput('identity-prefix') || 'Apple Development';

    // Generate a keychain password at runtime
    const keychainPassword = randomBytes(24).toString('hex');

    // Create temp working dir and write certificate to file
    const workDir = mkdtempSync(join(tmpdir(), 'tauri-apple-cert-'));
    const certPath = join(workDir, 'certificate.p12');
    const keychainName = 'build.keychain';

    // Persist state for post cleanup
    core.saveState('keychainName', keychainName);
    core.saveState('keychainPassword', keychainPassword);

    // Write certificate file
    const certBuffer = Buffer.from(appleCertBase64, 'base64');
    writeFileSync(certPath, certBuffer);

    // Keychain operations
    await exec(`security create-keychain -p '${keychainPassword}' '${keychainName}'`);
    await exec(`security default-keychain -s '${keychainName}'`);
    await exec(`security unlock-keychain -p '${keychainPassword}' '${keychainName}'`);
    await exec(`security set-keychain-settings -t 3600 -u '${keychainName}'`);

    // Import certificate
    await exec(`security import '${certPath}' -k '${keychainName}' -P '${appleCertPassword}' -T /usr/bin/codesign`);

    // Allow codesign to access the key
    await exec(`security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k '${keychainPassword}' '${keychainName}'`);

    // Find identities and filter by prefix
    const { stdout } = await exec(`security find-identity -v -p codesigning '${keychainName}' | cat`);

    const lines = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const match = lines.find((l) => {
      const m = l.match(/\"([^\"]+)\"/);
      const name = m?.[1] ?? '';
      return name.startsWith(identityPrefix);
    });
    if (!match) {
      core.warning('No matching identity found. Printing all identities for debugging.');
      const { stdout } = await exec(`security find-identity -p codesigning '${keychainName}' | cat`);
      core.info(stdout);

      throw new Error(`No identity found with prefix: ${identityPrefix}`);
    }

    // Extract quoted identity: 1) <hash> "Identity Name"
    const quoted = match.match(/"([^"]+)"/);
    const certId = quoted?.[1] ?? '';
    if (!certId) {
      throw new Error('Failed to parse certificate identity');
    }

    // Outputs
    core.setOutput('cert-id', certId);
    core.setOutput('cert-info', match);

    core.info('Certificate imported and keychain configured.');
  } catch (error: unknown) {
    core.setFailed((error as Error).message);
  }
}

run();
