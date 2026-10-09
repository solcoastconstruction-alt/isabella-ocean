/* Isabella the Mermaid — configuration for the app-store builds (flavor 'appstore' on iOS; 'play' later).
 * This file replaces web/config.js in those builds. The price is never written here: the paywall
 * shows the store's own localized price, read through window.IsabellaBilling. */
window.IsabellaConfig = {
  flavor: window.IsabellaFlavor || 'appstore',
  freeLevels: 10,
};
