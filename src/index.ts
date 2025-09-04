import * as core from '@actions/core';
import { exec as rawExec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(rawExec);

function sh(str: string): string {
  return str.replace(/'/g, "'\\''");
}

async function run(): Promise<void> {
  try {
    // Inputs
    const appleCertBase64 = core.getInput('apple-certificate', {
      required: true,
    });
    const appleCertPassword = core.getInput('apple-certificate-password', {
      required: true,
    });
    const identityPrefix = core.getInput('identity-prefix') || 'Apple Development';

    // Generate a keychain password at runtime
    const keychainPassword = randomBytes(24).toString('hex');

    // Create temp working dir and write certificate to file
    const workDir = mkdtempSync(join(tmpdir(), 'tauri-apple-cert-'));
    const certPath = join(workDir, 'certificate.p12');

    // Use an absolute keychain path (.keychain-db on modern macOS)
    const home = process.env.HOME ?? homedir();
    const loginKeychain = join(home, 'Library', 'Keychains', 'login.keychain-db');
    const keychainName = `tauri-build-${Date.now()}.keychain-db`;
    const keychainPath = join(home, 'Library', 'Keychains', keychainName);

    // Persist state for post cleanup
    core.saveState('keychainPath', keychainPath);
    core.saveState('keychainPassword', keychainPassword);

    // Write certificate file
    const certBuffer = Buffer.from(appleCertBase64, 'base64');
    writeFileSync(certPath, certBuffer);

    // Capture current keychain search list (for restore in post)
    const { stdout: prevList } = await exec(`security list-keychains -d user`);
    core.saveState('prevKeychains', prevList);

    // Keychain operations
    await exec(`security create-keychain -p '${keychainPassword}' '${keychainPath}'`);
    // Add our keychain alongside the login keychain to preserve trust chain resolution
    await exec(`security list-keychains -d user -s '${loginKeychain}' '${keychainPath}'`);
    // Keep default keychain as login; just unlock and use our keychain explicitly
    await exec(`security unlock-keychain -p '${keychainPassword}' '${keychainPath}'`);
    await exec(`security set-keychain-settings -t 3600 -u '${keychainPath}'`);

    // Import certificate (with private key) into the explicit keychain
    await exec(`security import '${certPath}' -k '${keychainPath}' -P '${appleCertPassword}' -f pkcs12 -A -T /usr/bin/codesign`);

    // Allow codesign to access the key
    await exec(`security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k '${keychainPassword}' '${keychainPath}'`);

    // Find identities in our keychain and filter by prefix
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
      core.warning('No matching valid identity found. Attempting to force trust the imported certificate...');

      // Try to export the leaf certificate (PEM) from our keychain by prefix
      const cerPath = join(workDir, 'leaf.cer');
      try {
        const { stdout: certPem } = await exec(`security find-certificate -c '${sh(identityPrefix)}' -p '${keychainPath}' | cat`);
        if (certPem && certPem.includes('BEGIN CERTIFICATE')) {
          writeFileSync(cerPath, certPem);
          // Add as trusted (as root) in our temp keychain to satisfy trust evaluation
          await exec(`security add-trusted-cert -k '${keychainPath}' -r trustAsRoot '${cerPath}'`);
        } else {
          core.warning('Could not extract certificate PEM by prefix; skipping trust override.');
        }
      } catch (e) {
        core.warning(`Failed to export and trust certificate: ${(e as Error).message}`);
      }

      // Retry identity lookup after trust adjustment
      const { stdout: retryOut } = await exec(`security find-identity -v -p codesigning '${keychainPath}' | cat`);
      const retryLines = retryOut
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const retryMatch = retryLines.find((l) => {
        const m = l.match(/\"([^\"]+)\"/);
        const name = m?.[1] ?? '';
        return name.startsWith(identityPrefix);
      });

      if (!retryMatch) {
        core.warning('No matching identity found after trust override. Printing all identities for debugging.');
        core.info(retryOut || stdout);
        throw new Error(`No identity found with prefix: ${identityPrefix}`);
      }

      // Use the retried match
      const quotedRetry = retryMatch.match(/"([^"]+)"/);
      const certIdRetry = quotedRetry?.[1] ?? '';
      if (!certIdRetry) {
        throw new Error('Failed to parse certificate identity after trust override');
      }
      core.setOutput('cert-id', certIdRetry);
      core.setOutput('cert-info', retryMatch);
      core.info('Certificate imported, trust overridden, and keychain configured.');
      return;
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
