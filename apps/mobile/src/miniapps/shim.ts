/**
 * The injected window.nostr / window.webln shim — a STATIC string, evaluated
 * in the WebView main frame at document start. Deliberately zero interpolation:
 * nothing app- or user-specific may be baked into injected code, so there is
 * no injection surface on our side of the fence.
 *
 * The shim holds no secrets and makes no decisions: every call is forwarded as
 * JSON-RPC over ReactNativeWebView.postMessage and judged by the firewall on
 * the native side. Page JS can of course replace this object — that only lets
 * a page lie to itself; the bridge trusts none of it.
 *
 * Each RPC carries `window.__fpT`, a per-session token the shell injects into
 * the MAIN FRAME ONLY (as a separate statement prepended at inject time; this
 * body stays zero-interpolation). ReactNativeWebView.postMessage is reachable
 * from every frame, so a cross-origin sub-iframe could otherwise call the
 * bridge and be judged under the host app's origin — the token, which a
 * cross-origin frame cannot read from the main frame, is what fences it out.
 */
export const MINIAPP_SHIM = `(function () {
  if (window.__fpMiniApp) return; window.__fpMiniApp = true;
  var pending = Object.create(null);
  var seq = 0;
  function rpc(method, params) {
    return new Promise(function (resolve, reject) {
      if (!window.ReactNativeWebView) return reject(new Error('no bridge'));
      var id = String(++seq) + '.' + Math.random().toString(36).slice(2);
      pending[id] = { resolve: resolve, reject: reject };
      window.ReactNativeWebView.postMessage(JSON.stringify({ __fp: 1, t: window.__fpT, id: id, method: method, params: params || {} }));
    });
  }
  window.__fpBridgeResolve = function (msg) {
    if (!msg || typeof msg.id !== 'string') return;
    var p = pending[msg.id];
    if (!p) return;
    delete pending[msg.id];
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || 'denied'));
  };
  window.nostr = {
    getPublicKey: function () { return rpc('getPublicKey'); },
    signEvent: function (event) { return rpc('signEvent', { event: event }); },
    nip04: {
      encrypt: function (peer, plaintext) { return rpc('nip04.encrypt', { peer: peer, plaintext: plaintext }); },
      decrypt: function (peer, ciphertext) { return rpc('nip04.decrypt', { peer: peer, ciphertext: ciphertext }); }
    },
    nip44: {
      encrypt: function (peer, plaintext) { return rpc('nip44.encrypt', { peer: peer, plaintext: plaintext }); },
      decrypt: function (peer, ciphertext) { return rpc('nip44.decrypt', { peer: peer, ciphertext: ciphertext }); }
    }
  };
  window.freeport = {
    // Freeport extension: pay a Spark address in sats or a stablecoin token.
    // Always shows a native approval dialog — no standing grant exists for it.
    paySpark: function (args) {
      args = args || {};
      return rpc('freeport.paySpark', { address: args.address, sats: args.sats, token: args.token });
    },
    getBalance: function () { return rpc('freeport.getBalance'); },
    getLocation: function () { return rpc('freeport.getLocation'); },
    saveFile: function (args) {
      args = args || {};
      return rpc('freeport.saveFile', { name: args.name, mimeType: args.mimeType, dataBase64: args.dataBase64 });
    }
  };
  window.webln = {
    enable: function () { return rpc('webln.enable'); },
    getInfo: function () { return rpc('webln.getInfo'); },
    makeInvoice: function (args) {
      args = args || {};
      var amount = typeof args === 'number' ? args : Number(args.amount);
      return rpc('webln.makeInvoice', { amount: amount, defaultMemo: (args && args.defaultMemo) || '' });
    },
    sendPayment: function (paymentRequest) { return rpc('webln.sendPayment', { invoice: paymentRequest }); }
  };
  // One-shot liveness ping: the first time page JS touches any of the three
  // API globals, tell the shell "this page behaves like a mini-app". A page
  // that never looks at them trips the shell's not-a-mini-app notice. Carries
  // no authority — it only hides a warning banner.
  var alive = false;
  function hello() {
    if (alive) return; alive = true;
    try { window.ReactNativeWebView.postMessage('__fp_hello'); } catch (e) {}
  }
  ['nostr', 'webln', 'freeport'].forEach(function (k) {
    var v = window[k];
    try {
      Object.defineProperty(window, k, {
        configurable: true,
        get: function () { hello(); return v; },
        set: function (nv) { v = nv; }
      });
    } catch (e) {}
  });
})(); true;`;
