/* Isabella Ocean on iOS — what the page can call. GameViewController puts this in every page before
 * any of the page's own scripts run, with __BOOT__ replaced by the saved games and the purchase state.
 *
 *   IsabellaStore.get(key) / set(key, value)   game saves, kept in UserDefaults (same shape as the
 *                                              Android app's SharedPreferences bridge)
 *   IsabellaBilling                            the in-app purchase (the contract is in web-iap/paywall.js)
 *   IsabellaApp.openUrl(url)                   opens the game's own site in the browser; nothing else
 */
(function () {
  'use strict';
  if (window.IsabellaStore) return;
  var boot = __BOOT__;
  var handlers = window.webkit.messageHandlers;

  var saves = boot.store || {};
  window.IsabellaStore = {
    get: function (key) { return Object.prototype.hasOwnProperty.call(saves, key) ? saves[key] : null; },
    set: function (key, value) {
      saves[key] = String(value);
      handlers.store.postMessage({ key: String(key), value: String(value) });
    },
  };

  var state = boot.billing || { owned: false, price: null, ready: false };
  var listeners = [];
  // Called by the app whenever the purchase state changes.
  window.__billingState = function (next) {
    state = next;
    listeners.slice().forEach(function (fn) { try { fn(state); } catch (e) { /* a listener's bug is not ours */ } });
  };
  function call(op) {
    return handlers.billing.postMessage({ op: op }).then(function (reply) {
      reply = reply || {};
      if (reply.state) window.__billingState(reply.state);
      if (reply.error) { var e = new Error(reply.error); e.code = reply.error; throw e; }
      return reply;
    });
  }
  window.IsabellaBilling = {
    state: function () { return state; },
    buy: function () { return call('buy'); },
    restore: function () { return call('restore'); },
    redeem: function () { return call('redeem'); },
    refresh: function () { return call('refresh'); },
    onChange: function (fn) {
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
  };

  window.IsabellaApp = {
    openUrl: function (url) { handlers.app.postMessage({ op: 'open', url: String(url) }); return true; },
  };
})();
