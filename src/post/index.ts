import * as core from '@actions/core';
import { exec as rawExec } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(rawExec);

async function cleanup(): Promise<void> {
  const keychainPath = core.getState('keychainPath') || `${process.env.RUNNER_TEMP}/app-signing.keychain-db`;
  const keychainPassword = core.getState('keychainPassword');

  try {
    if (keychainPassword) {
      await exec(`security unlock-keychain -p '${keychainPassword}' '${keychainPath}'`).catch(() => {});
    }
    await exec(`security delete-keychain '${keychainPath}'`);
    core.info(`Deleted keychain ${keychainPath}`);
  } catch (err: unknown) {
    core.warning(`Cleanup encountered an issue: ${(err as Error).message}`);
  }
}

cleanup();
