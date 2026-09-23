import type { WowFlavor, WowFolderPick } from '../main/ipc.js';
import type { Snapshot } from '../main/state.js';
import { accountLine, addonLine, chicagoTime, ipcErrorMessage, uploadsLine } from './format.js';

// Everything user- or server-provided goes in with textContent; never innerHTML.

const api = window.ledger;
const MAX_LOG_LINES = 50;
let current: Snapshot | undefined;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

function setText(id: string, text: string) {
  el(id).textContent = text;
}

/** Shows `text` in an element that is hidden when empty. */
function setOptional(id: string, text: string | undefined) {
  const e = el(id);
  e.textContent = text ?? '';
  e.hidden = !text;
}

function setList(id: string, lines: string[]) {
  const list = el(id);
  list.replaceChildren(
    ...lines.map((l) => {
      const li = document.createElement('li');
      li.textContent = l;
      return li;
    }),
  );
}

/** Runs a button's action with the button disabled; errors go to `errorId`. */
function action(buttonId: string, errorId: string, fn: () => Promise<unknown>) {
  const button = el<HTMLButtonElement>(buttonId);
  button.addEventListener('click', () => {
    button.disabled = true;
    setOptional(errorId, undefined);
    fn()
      .catch((err: unknown) => setOptional(errorId, ipcErrorMessage(err)))
      .finally(() => {
        button.disabled = false;
      });
  });
}

function pickSummary(pick: WowFolderPick): string[] {
  if (pick.accounts.length) return [`Found ForeverLedger data for: ${pick.accounts.join(', ')}`];
  return pick.notes.length
    ? pick.notes
    : ['No ForeverLedger data here yet; that is fine for a first run.'];
}

const flavorLabel = (f: WowFlavor) =>
  f.accounts.length
    ? `${f.name} (${f.accounts.join(', ')})`
    : `${f.name} (no ForeverLedger data yet)`;

/**
 * Shows what a folder pick found in the list `listId`. With several game flavors, one button per flavor; `onChoose`
 * gets the chosen flavor folder (or the picked folder when there is only one flavor).
 */
function showPick(listId: string, pick: WowFolderPick, onChoose: (path: string) => void) {
  const list = el(listId);
  if (!pick.flavors || pick.flavors.length < 2) {
    list.classList.remove('flavors');
    setList(listId, pickSummary(pick));
    onChoose(pick.path);
    return;
  }
  list.classList.add('flavors');
  const intro = document.createElement('li');
  intro.textContent = 'Several game versions here. Which one do you play with the addon?';
  const buttons = pick.flavors.map((f) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = flavorLabel(f);
    b.addEventListener('click', () => {
      for (const other of list.querySelectorAll('button')) other.classList.remove('chosen');
      b.classList.add('chosen');
      onChoose(f.path);
    });
    li.append(b);
    return li;
  });
  list.replaceChildren(intro, ...buttons);
}

// ---- setup ----
let setupWowPath: string | undefined;
action('setup-pick', 'setup-error', async () => {
  const pick = await api.pickWowFolder();
  if (!pick) return;
  setupWowPath = undefined;
  setText('setup-wow', pick.path);
  showPick('setup-found', pick, (path) => {
    setupWowPath = path;
    setText('setup-wow', path);
  });
});
action('setup-save', 'setup-error', async () => {
  const token = el<HTMLInputElement>('setup-token').value.trim();
  const wowPath = setupWowPath ?? current?.settings.wowPath;
  if (!wowPath) throw new Error('Choose your World of Warcraft folder (and game version) first.');
  if (!token && !current?.settings.tokenSet) throw new Error('Paste your upload token.');
  await api.saveSettings({ wowPath, token });
  el<HTMLInputElement>('setup-token').value = '';
});

// ---- main ----
action('upload-now', 'uploads-error', () => api.uploadNow());
action('pause', 'uploads-error', () => api.setPaused(!current?.paused));
action('addon-update', 'addon-error', () => api.addonUpdateNow());
action('addon-rollback', 'addon-error', () => api.addonRollback());
action('restart-update', 'settings-error', () => api.restartToUpdate());
action('open-logs', 'settings-error', () => api.openLogs());
action('set-pick', 'settings-error', async () => {
  const pick = await api.pickWowFolder();
  if (!pick) return;
  showPick('set-found', pick, (path) => {
    setOptional('settings-error', undefined);
    api
      .saveSettings({ wowPath: path })
      .catch((err: unknown) => setOptional('settings-error', ipcErrorMessage(err)));
  });
});
action('set-token-save', 'settings-error', async () => {
  const input = el<HTMLInputElement>('set-token');
  const token = input.value.trim();
  if (!token) throw new Error('Paste the new token first.');
  await api.saveSettings({ token });
  input.value = '';
});
for (const [id, key] of [
  ['set-startup', 'startWithWindows'],
  ['set-autoaddon', 'autoUpdateAddon'],
] as const) {
  const box = el<HTMLInputElement>(id);
  box.addEventListener('change', () => {
    setOptional('settings-error', undefined);
    api
      .saveSettings({ [key]: box.checked })
      .catch((err: unknown) => setOptional('settings-error', ipcErrorMessage(err)));
  });
}

function render(s: Snapshot) {
  current = s;
  el('setup').hidden = !s.setupNeeded;
  el('main').hidden = s.setupNeeded;
  setOptional('banner', s.fatal ?? s.warning);

  if (s.setupNeeded) {
    if (!setupWowPath && s.settings.wowPath) setText('setup-wow', s.settings.wowPath);
    el<HTMLInputElement>('setup-token').placeholder = s.settings.tokenSet
      ? 'Token already saved (paste to replace)'
      : '';
    el<HTMLInputElement>('setup-server').value =
      s.settings.serverUrl ?? 'https://ledger.willikers.dev';
    return;
  }

  // Uploads
  setText('uploads-line', uploadsLine(s));
  setList('uploads-accounts', s.accounts.map(accountLine));
  const lastError = s.accounts.find((a) => a.lastError)?.lastError;
  setOptional(
    'uploads-error',
    lastError ? `${chicagoTime(lastError.at)}: ${lastError.message}` : undefined,
  );
  el<HTMLButtonElement>('upload-now').disabled = s.paused;
  setText('pause', s.paused ? 'Resume uploads' : 'Pause uploads');

  // Addon
  setText('addon-line', addonLine(s));
  const detail: string[] = [];
  if (s.addon) detail.push(`Last checked ${chicagoTime(s.addon.checkedAt * 1000)}`);
  if (s.addonPausedFor)
    detail.push(`Rolled back: waiting for a version other than ${s.addonPausedFor}`);
  if (s.addon?.skipped?.length) detail.push('A linked developer copy is left alone');
  if (!s.settings.autoUpdateAddon) detail.push('Automatic updates are off');
  setText('addon-detail', detail.join(' · '));
  // A fresh failure is shown neutrally while it is retried; red once it persists.
  const addonError = s.addon?.status === 'error' ? s.addon.error : undefined;
  setOptional('addon-error', s.addonRetrying ? undefined : addonError);
  setOptional('addon-note', s.addonRetrying ? addonError : undefined);

  // App
  setText(
    'app-line',
    s.appUpdateReady
      ? `Version ${s.appVersion} · ${s.appUpdateReady} is downloaded and ready`
      : `Version ${s.appVersion}`,
  );
  el('restart-update').hidden = !s.appUpdateReady;

  // Settings
  setText('set-wow', s.settings.wowPath ?? 'Not set');
  setText('set-server', s.settings.serverUrl ?? '');
  setText('set-token-state', s.settings.tokenSet ? '(saved)' : '(not set)');
  el<HTMLInputElement>('set-startup').checked = s.settings.startWithWindows;
  el<HTMLInputElement>('set-autoaddon').checked = s.settings.autoUpdateAddon;
}

// ---- activity ----
const log = el('log');
function appendLog(line: string) {
  const li = document.createElement('li');
  li.textContent = line;
  if (/\] (WARN|ERROR|FATAL) /.test(line)) li.className = 'bad';
  log.append(li);
  while (log.childElementCount > MAX_LOG_LINES) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

api.onChange(render);
api.onLogLine(appendLog);
void api.getState().then(render);
void api.getLog().then((lines) => {
  log.replaceChildren();
  for (const l of lines) appendLog(l);
});
