/*!
 * Freeport mini-app SDK — makes a web page a Freeport mini-app when it runs
 * inside the Freeport WEB shell (a sandboxed cross-origin iframe).
 *
 *   <script src="https://freeport.network/sdk.js"></script>
 *
 * Exposes the same surface as the native shell: window.nostr (NIP-07),
 * window.webln (WebLN) and window.freeport (paySpark). Inside the NATIVE
 * shell the injected shim is already present and this file does nothing, so
 * one page works in both shells.
 *
 * Security note for integrators: this SDK is NOT trusted by Freeport — every
 * request it relays is re-validated and permission-checked by the shell's
 * firewall, and each sensitive action shows a native/parent-DOM approval
 * dialog. It holds no secrets and cannot be abused into holding any.
 */
(function () {
  'use strict';
  if (window.__fpMiniApp) return;                     // native shell shim already installed
  if (window.__fpSdk) return;                         // double-include guard
  // Only act when actually embedded (iframe or opened window). In a normal
  // top-level tab we must not shadow a real NIP-07 extension (Alby, nos2x).
  var embedded = (window !== window.top) || !!window.opener;
  if (!embedded) return;
  window.__fpSdk = true;

  var port = null;
  var shellOrigin = '';
  var queue = [];
  var pending = Object.create(null);
  var seq = 0;
  var CONNECT_TIMEOUT_MS = 15000;

  function rpc(method, params) {
    return new Promise(function (resolve, reject) {
      var id = String(++seq) + '.' + Math.random().toString(36).slice(2);
      pending[id] = { resolve: resolve, reject: reject };
      var msg = JSON.stringify({ __fp: 1, id: id, method: method, params: params || {} });
      if (port) port.postMessage(msg);
      else {
        queue.push(msg);
        setTimeout(function () {
          if (pending[id] && !port) { delete pending[id]; reject(new Error('no Freeport shell')); }
        }, CONNECT_TIMEOUT_MS);
      }
    });
  }

  // Handshake: the shell posts { __fp: 'connect' } with a dedicated
  // MessagePort, targetOrigin pinned to this page's origin. All RPC flows on
  // that port afterwards. A re-handshake (page kept alive, shell reloaded)
  // replaces the port.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__fp !== 'connect' || !e.ports || !e.ports[0]) return;
    shellOrigin = e.origin;
    if (port) { try { port.close(); } catch (err) {} }
    port = e.ports[0];
    port.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (err) { return; }
      if (!msg || typeof msg.id !== 'string') return;
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || 'denied'));
    };
    if (port.start) port.start();
    while (queue.length) port.postMessage(queue.shift());
    try { window.dispatchEvent(new Event('freeport:connected')); } catch (err) {}
  });

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
    paySpark: function (args) {
      args = args || {};
      return rpc('freeport.paySpark', { address: args.address, sats: args.sats, token: args.token });
    },
    isConnected: function () { return !!port; },
    shellOrigin: function () { return shellOrigin; }
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
})();
