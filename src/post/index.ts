import * as core from '@actions/core';
import { exec as rawExec } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(rawExec);

async function cleanup(): Promise<void> {
  const keychainName = core.getState('keychainName') || 'build.keychain';
  const keychainPassword = core.getState('keychainPassword');
  try {
    if (keychainPassword) {
      await exec(`security unlock-keychain -p '${keychainPassword}' '${keychainName}'`).catch(() => {});
    }
    // Try to restore default keychain to login, ignore failures
    await exec("security default-keychain -s 'login.keychain-db'").catch(async () => {
      await exec("security default-keychain -s 'login.keychain'").catch(() => {});
    });
    await exec(`security delete-keychain '${keychainName}'`);
    core.info(`Deleted keychain ${keychainName}`);
  } catch (err: unknown) {
    core.warning(`Failed to delete keychain ${keychainName}: ${(err as Error).message}`);
  }
}

cleanup();
