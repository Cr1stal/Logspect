import { app, dialog, shell } from 'electron';
import log from "electron-log";

const RELEASES_URL = 'https://github.com/Cr1stal/Logspect/releases';

/**
 * Open the GitHub releases page for manual updates.
 * @param {BrowserWindow} mainWindow - The main application window
 */
export const checkForUpdatesManually = async (mainWindow) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Manual Updates',
    message: 'Automatic updates are not available in this build.',
    detail: `Logspect ${app.getVersion()} uses GitHub Releases for manual downloads.\n\nOpen the latest releases page now?`,
    buttons: ['Open Releases', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  });

  if (response === 0) {
    log.info('Opening GitHub releases page for manual update downloads');
    await shell.openExternal(RELEASES_URL);
  }
};

/**
 * Logs the current update mode for packaged builds.
 */
export const setupAutoUpdater = () => {
  if (app.isPackaged) {
    log.info('Automatic updates are disabled for Electron Forge releases. Users update via GitHub Releases.');
  }
};

/**
 * Automatic startup checks are intentionally disabled for unsigned Forge builds.
 */
export const checkForUpdatesOnStartup = () => {
  return;
};
