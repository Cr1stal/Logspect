import { app, dialog } from 'electron';
import pkg from "electron-updater";
import log from "electron-log";

const { autoUpdater } = pkg;
let updateCheckInProgress = false;

/**
 * Manually check for updates (triggered from menu)
 * @param {BrowserWindow} mainWindow - The main application window
 */
export const checkForUpdatesManually = async (mainWindow) => {
  if (updateCheckInProgress) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Check in Progress',
      message: 'An update check is already in progress.',
      detail: 'Please wait for the current check to complete.',
      buttons: ['OK']
    });
    return;
  }

  updateCheckInProgress = true;

  try {
    log.info('Manual update check initiated');

    // Show checking dialog (non-blocking)
    const checkingDialog = dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Checking for Updates',
      message: 'Checking for updates...',
      detail: 'Please wait while we check for the latest version.',
      buttons: ['Cancel'],
      defaultId: 0
    });

    // Set up one-time event listeners for this manual check
    const onUpdateAvailable = (info) => {
      updateCheckInProgress = false;
      // The regular update-available handler will show the download dialog
    };

    const onUpdateNotAvailable = (info) => {
      updateCheckInProgress = false;
      autoUpdater.removeListener('update-available', onUpdateAvailable);
      autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
      autoUpdater.removeListener('error', onUpdateError);

      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No Updates Available',
        message: 'You have the latest version!',
        detail: `Logspect ${app.getVersion()} is the latest version available.`,
        buttons: ['OK']
      });
    };

    const onUpdateError = (error) => {
      updateCheckInProgress = false;
      autoUpdater.removeListener('update-available', onUpdateAvailable);
      autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
      autoUpdater.removeListener('error', onUpdateError);

      log.error('Manual update check error:', error);
      dialog.showErrorBox('Update Check Failed',
        'Failed to check for updates. Please check your internet connection and try again.');
    };

    // Add temporary event listeners
    autoUpdater.once('update-available', onUpdateAvailable);
    autoUpdater.once('update-not-available', onUpdateNotAvailable);
    autoUpdater.once('error', onUpdateError);

    // Start the update check
    await autoUpdater.checkForUpdates();

  } catch (error) {
    updateCheckInProgress = false;
    log.error('Manual update check failed:', error);
    dialog.showErrorBox('Update Check Failed',
      'Failed to check for updates. Please try again later.');
  }
};

/**
 * Sets up auto-updater event handlers
 * @param {BrowserWindow} mainWindow - The main application window
 */
export const setupAutoUpdater = (mainWindow) => {
  // When update is available, show prompt
  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);

    const dialogOpts = {
      type: 'info',
      buttons: ['Download Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Available',
      message: `A new version of Logspect is available!`,
      detail: `Version ${info.version} is now available. Would you like to download it now?\n\nThe update will be downloaded in the background.`
    };

    dialog.showMessageBox(mainWindow, dialogOpts).then((returnValue) => {
      if (returnValue.response === 0) {
        // User chose to download
        log.info('User chose to download update');
        autoUpdater.downloadUpdate();

        // Show download progress notification
        if (mainWindow) {
          mainWindow.webContents.send('update-download-started');
        }
      } else {
        log.info('User chose to skip update');
      }
    });
  });

  // When update is downloaded, show restart prompt
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);

    const dialogOpts = {
      type: 'info',
      buttons: ['Restart Now', 'Restart Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready to Install',
      message: `Update downloaded successfully!`,
      detail: `Version ${info.version} has been downloaded and is ready to install. The application will restart to apply the update.`
    };

    dialog.showMessageBox(mainWindow, dialogOpts).then((returnValue) => {
      if (returnValue.response === 0) {
        log.info('User chose to restart now');
        autoUpdater.quitAndInstall();
      } else {
        log.info('User chose to restart later');
        // The update will be applied the next time the app is started
      }
    });
  });

  // Handle download progress
  autoUpdater.on('download-progress', (progressObj) => {
    let logMessage = `Download speed: ${progressObj.bytesPerSecond}`;
    logMessage += ` - Downloaded ${progressObj.percent}%`;
    logMessage += ` (${progressObj.transferred}/${progressObj.total})`;
    log.info(logMessage);

    // Send progress to renderer if needed
    if (mainWindow) {
      mainWindow.webContents.send('update-download-progress', {
        percent: Math.round(progressObj.percent),
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    }
  });

  // Handle errors
  autoUpdater.on('error', (err) => {
    log.error('Auto updater error:', err);

    if (mainWindow) {
      dialog.showErrorBox('Update Error',
        'There was an error checking for updates. Please try again later or download the latest version manually from our website.');
    }
  });

  // Handle when no update is available
  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
  });

  // Configure auto updater
  if (!app.isPackaged) {
    console.log('Setting up auto updater in development mode');
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = "debug";
    autoUpdater.forceDevUpdateConfig = true;
  }
};

/**
 * Automatically check for updates (called on app startup)
 */
export const checkForUpdatesOnStartup = () => {
  if (app.isPackaged) {
    log.info('Checking for updates...');
    autoUpdater.checkForUpdatesAndNotify();
  }
};