import * as core from '@actions/core';
import { exec as rawExec } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(rawExec);

async function cleanup(): Promise<void> {
  const keychainPath = core.getState('keychainPath');
  const keychainPassword = core.getState('keychainPassword');
  const prevKeychains = core.getState('prevKeychains');

  try {
    // Best effort: restore previous keychain search list
    if (prevKeychains) {
      const paths = Array.from(prevKeychains.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
      if (paths.length > 0) {
        const quoted = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
        await exec(`security list-keychains -d user -s ${quoted}`).catch(() => {});
      }
    }

    // Reset default keychain back to login
    await exec("security default-keychain -s 'login.keychain-db'").catch(async () => {
      await exec("security default-keychain -s 'login.keychain'").catch(() => {});
    });

    // Unlock and delete our temporary keychain
    if (keychainPath) {
      if (keychainPassword) {
        await exec(`security unlock-keychain -p '${keychainPassword}' '${keychainPath}'`).catch(() => {});
      }
      await exec(`security delete-keychain '${keychainPath}'`);
      core.info(`Deleted keychain ${keychainPath}`);
    }
  } catch (err: unknown) {
    core.warning(`Cleanup encountered an issue: ${(err as Error).message}`);
  }
}

cleanup();
