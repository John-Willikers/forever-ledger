// When the helper may work: the PC has been idle for a while, it is on mains power, and World of Warcraft isn't
// running. Reading the process list is the only thing it looks at on the PC, and only for WoW's name. When the list
// can't be read, it assumes WoW is running and waits.
import { execFile } from 'node:child_process';
import { powerMonitor } from 'electron';
import { IDLE_SECONDS, isWowRunning, processNames, tasklistPath } from './policy.js';

function wowRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      tasklistPath(),
      ['/fo', 'csv', '/nh'],
      { windowsHide: true, timeout: 10_000 },
      (err, out) => resolve(err ? true : isWowRunning(processNames(String(out)))),
    );
  });
}

/** Why the helper must wait right now, or null when it may fetch. */
export async function blockedBy(): Promise<string | null> {
  if (powerMonitor.getSystemIdleTime() < IDLE_SECONDS)
    return 'waiting until you step away from the PC';
  if (powerMonitor.isOnBatteryPower()) return 'waiting for the PC to be plugged in';
  if (await wowRunning()) return 'waiting until World of Warcraft is closed';
  return null;
}
