import * as core from '@actions/core';
import { exec as rawExec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(rawExec);

async function run(): Promise<void> {
  try {
    // Inputs
    const appleCertBase64 = core.getInput('apple-certificate', { required: true });
    const appleCertPassword = core.getInput('apple-certificate-password', { required: true });
    const identityPrefix = core.getInput('identity-prefix') || 'Apple Development';

    // Paths (align with GitHub docs using RUNNER_TEMP)
    const runnerTemp = process.env.RUNNER_TEMP || tmpdir();
    const certPath = join(runnerTemp, 'build_certificate.p12');
    const keychainPath = join(runnerTemp, 'app-signing.keychain-db');

    // Generate a keychain password at runtime
    const keychainPassword = randomBytes(24).toString('hex');

    // Persist state for post cleanup
    core.saveState('keychainPath', keychainPath);
    core.saveState('keychainPassword', keychainPassword);

    // Write certificate file
    const certBuffer = Buffer.from(appleCertBase64, 'base64');
    writeFileSync(certPath, certBuffer);

    // Create and configure temporary keychain
    await exec(`security create-keychain -p '${keychainPassword}' '${keychainPath}'`);
    await exec(`security set-keychain-settings -lut 21600 '${keychainPath}'`);
    await exec(`security unlock-keychain -p '${keychainPassword}' '${keychainPath}'`);

    // Import certificate and allow Apple tools access
    await exec(`security import '${certPath}' -P '${appleCertPassword}' -A -t cert -f pkcs12 -k '${keychainPath}'`);
    await exec(`security set-key-partition-list -S apple-tool:,apple: -k '${keychainPassword}' '${keychainPath}'`);

    // Use only our temporary keychain for this job
    await exec(`security list-keychains -d user -s '${keychainPath}'`);

    // Discover identities and filter by prefix
    const { stdout } = await exec(`security find-identity -v -p codesigning '${keychainPath}' | cat`);
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
      core.info(stdout || 'No identities listed.');
      throw new Error(`No identity found with prefix: ${identityPrefix}`);
    }

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
