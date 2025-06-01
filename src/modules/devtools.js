import { app } from 'electron';

/**
 * Checks if we're in development mode
 * @returns {boolean}
 */
export const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/**
 * Vite development server URL
 */
export const VITE_DEV_SERVER_URL = 'http://localhost:5173';

/**
 * Installs Vue DevTools in development mode
 */
export const installVueDevTools = () => {
  if (isDev) {
    import('electron-devtools-installer').then(({ default: installExtension, VUEJS3_DEVTOOLS }) => {
      app.whenReady().then(() => {
        installExtension(VUEJS3_DEVTOOLS)
          .then((name) => console.log(`Added Extension: ${name}`))
          .catch((err) => console.log('An error occurred installing Vue DevTools: ', err));
      });
    }).catch(err => {
      console.log('Could not load electron-devtools-installer:', err);
    });
  }
};