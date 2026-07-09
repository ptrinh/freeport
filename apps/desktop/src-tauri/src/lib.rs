//! Freeport desktop (Tauri v2).
//!
//! Ships the Freeport web bundle as a native window, plus an OPTIONAL built-in
//! host server: the user picks a port and Freeport serves the very same bundle
//! over HTTP on their LAN, so anyone on the network can open it in a browser —
//! a zero-infrastructure way to share/self-host Freeport when the store or
//! domain is unavailable. The served app still talks directly to the public
//! Nostr relays; this only distributes the client, it is not a relay or notifier.

use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, State};
use tiny_http::{Header, Request, Response, Server};

/// Fixed loopback port the bundled notification-server sidecar binds to; the
/// public host server reverse-proxies notifier routes here.
const INTERNAL_NOTIFIER_PORT: u16 = 47615;

/// Resolves a request path to (bytes, mime). Backed by Tauri's single embedded
/// copy of the web bundle (no second include_dir embed) — the GUI closure uses
/// the AppHandle asset resolver, the headless closure uses the context assets.
type AssetSource = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync + 'static>;

/// Held in Tauri state so host_start can hand the resolver to the server thread.
struct Assets(AssetSource);

/// Normalize a request URL to a Tauri asset key ("/index.html" for the root).
fn asset_key(url: &str) -> String {
    let clean = url.split(['?', '#']).next().unwrap_or("");
    let clean = clean.trim_start_matches('/');
    let path = if clean.is_empty() { "index.html" } else { clean };
    format!("/{path}")
}

#[derive(Default)]
struct HostState {
    running: bool,
    port: u16,
    notify: bool,
    telegram: bool,
    relay_port: u16,
    stop: Option<Arc<AtomicBool>>,
    handle: Option<JoinHandle<()>>,
    notifier: Option<Child>,
}

type HostMutex = Mutex<HostState>;

#[derive(Serialize, Clone)]
struct HostStatus {
    running: bool,
    port: u16,
    /// Whether the notification server is being hosted on the same port.
    notify: bool,
    /// Whether the Telegram bridge is active (a bot token was supplied).
    telegram: bool,
    /// True if a notifier sidecar is bundled in this build (feature available).
    notify_available: bool,
    /// Shareable URLs (one per non-loopback IPv4 interface) when running.
    urls: Vec<String>,
    /// Embedded relay ws:// URLs (present when notify is on).
    relay_urls: Vec<String>,
}

fn local_urls(port: u16) -> Vec<String> {
    let mut urls = Vec::new();
    if let Ok(ifaces) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in ifaces {
            if let std::net::IpAddr::V4(v4) = ip {
                if !v4.is_loopback() && !v4.is_link_local() {
                    urls.push(format!("http://{}:{}", v4, port));
                }
            }
        }
    }
    urls.sort();
    urls.dedup();
    urls
}

// ── Notification-server sidecar (bundled Bun-compiled freeport-nostr-mcp) ──────

/// Path to the notifier sidecar next to the main executable (Tauri places
/// externalBin there). None if this build didn't bundle it.
fn sidecar_path() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let name = if cfg!(windows) { "freeport-notifier.exe" } else { "freeport-notifier" };
    let p = dir.join(name);
    p.exists().then_some(p)
}

/// Whether the notifier feature is available in this build.
fn notifier_available() -> bool {
    sidecar_path().is_some()
}

/// Persistent data dir for the notifier (VAPID keys + push subscriptions).
fn notifier_data_dir() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .or_else(|| std::env::var_os("APPDATA").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("freeport-notifier");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn spawn_notifier(
    internal: u16,
    relay_port: u16,
    tg_token: Option<&str>,
    tg_passphrase: Option<&str>,
) -> std::io::Result<Child> {
    let path = sidecar_path()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "notifier not bundled"))?;
    let mut cmd = std::process::Command::new(path);
    cmd.env("HOST", "127.0.0.1")
        .env("PORT", internal.to_string())
        .env("ENABLE_NOTIFY", "1")
        // Also run the embedded NIP-01 relay on its own LAN-facing WS port,
        // so the node is a complete "Freeport in a box".
        .env("ENABLE_RELAY", "1")
        .env("RELAY_HOST", "0.0.0.0")
        .env("RELAY_PORT", relay_port.to_string())
        .env("DATA_DIR", notifier_data_dir())
        .env("VAPID_SUBJECT", "mailto:hi@freeport.network");
    // Optional Telegram bridge: enabled only when a bot token is supplied. The
    // guest passphrase additionally turns on custodial guest-agent mode.
    if let Some(tok) = tg_token.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.env("TELEGRAM_BOT_TOKEN", tok)
            .env("TELEGRAM_WEB_BASE", "https://freeport.network");
        if let Some(pass) = tg_passphrase.map(str::trim).filter(|s| !s.is_empty()) {
            cmd.env("TELEGRAM_GUEST_KEY_PASSPHRASE", pass);
        }
    }
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
}

/// ws:// URLs for the embedded relay (one per non-loopback IPv4 interface).
fn relay_urls(relay_port: u16) -> Vec<String> {
    local_urls(relay_port)
        .into_iter()
        .map(|u| u.replacen("http://", "ws://", 1))
        .collect()
}

/// Routes served by the notifier (everything else is the static web app).
fn is_notifier_path(url: &str) -> bool {
    let p = url.split(['?', '#']).next().unwrap_or("");
    p == "/health"
        || p == "/vapidPublicKey"
        || p.starts_with("/mcp")
        || p.starts_with("/subscribe")
        || p.starts_with("/unsubscribe")
        || p.starts_with("/telegram")
}

/// Forward a request to the loopback notifier and copy the response back.
fn proxy_to_notifier(mut req: Request, internal: u16) {
    let url = format!("http://127.0.0.1:{}{}", internal, req.url());
    let method = req.method().as_str().to_uppercase();
    let ctype = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Content-Type"))
        .map(|h| h.value.as_str().to_string());
    let mut body = Vec::new();
    let _ = req.as_reader().read_to_end(&mut body);

    let mut rb = ureq::request(&method, &url);
    if let Some(ct) = &ctype {
        rb = rb.set("Content-Type", ct);
    }
    let result = if body.is_empty() { rb.call() } else { rb.send_bytes(&body) };
    match result {
        Ok(resp) | Err(ureq::Error::Status(_, resp)) => {
            let status = resp.status();
            let ct = resp.content_type().to_string();
            let mut buf = Vec::new();
            let _ = resp.into_reader().read_to_end(&mut buf);
            let header = Header::from_bytes(&b"Content-Type"[..], ct.as_bytes())
                .unwrap_or_else(|_| Header::from_bytes(&b"Content-Type"[..], &b"application/octet-stream"[..]).unwrap());
            let len = buf.len();
            let _ = req.respond(Response::new(status.into(), vec![header], Cursor::new(buf), Some(len), None));
        }
        Err(_) => {
            // notifier still starting up or unreachable
            let _ = req.respond(Response::from_string("Notifier unavailable").with_status_code(502));
        }
    }
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "webmanifest" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "pdf" => "application/pdf",
        "txt" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// Resolve a request path from the embedded bundle, with SPA fallback: a bare
/// path or an extension-less/unknown route serves index.html (Freeport is a
/// single page); a missing asset with an extension returns 404.
fn lookup(assets: &AssetSource, req_path: &str) -> Option<(Vec<u8>, String)> {
    let key = asset_key(req_path);
    if let Some(hit) = assets(&key) {
        return Some(hit);
    }
    let looks_like_asset = key.rsplit('/').next().map(|s| s.contains('.')).unwrap_or(false);
    if looks_like_asset {
        return None; // real missing asset → 404
    }
    assets("/index.html")
}

fn serve_loop(server: Server, stop: Arc<AtomicBool>, notifier: Option<u16>, assets: AssetSource) {
    while !stop.load(Ordering::Relaxed) {
        match server.recv_timeout(Duration::from_millis(1000)) {
            Ok(Some(req)) => {
                if let Some(np) = notifier {
                    if is_notifier_path(req.url()) {
                        proxy_to_notifier(req, np);
                        continue;
                    }
                }
                let (body, ctype) = match lookup(&assets, req.url()) {
                    Some(hit) => hit,
                    None => {
                        let _ = req.respond(Response::from_string("Not found").with_status_code(404));
                        continue;
                    }
                };
                let header = Header::from_bytes(&b"Content-Type"[..], ctype.as_bytes())
                    .unwrap_or_else(|_| Header::from_bytes(&b"Content-Type"[..], &b"application/octet-stream"[..]).unwrap());
                let len = body.len();
                let resp = Response::new(200.into(), vec![header], Cursor::new(body), Some(len), None);
                let _ = req.respond(resp);
            }
            Ok(None) => continue, // timeout → re-check stop flag
            Err(_) => break,
        }
    }
    // server drops here → port released
}

#[tauri::command]
fn host_start(
    state: State<'_, HostMutex>,
    assets: State<'_, Assets>,
    port: u16,
    notify: bool,
    telegram_token: Option<String>,
    telegram_passphrase: Option<String>,
) -> Result<HostStatus, String> {
    if port < 1024 {
        return Err("Please choose a port of 1024 or higher.".into());
    }
    let mut st = state.lock().map_err(|_| "internal lock error")?;
    if st.running {
        return Err(format!("Already hosting on port {}. Stop it first.", st.port));
    }
    if notify && !notifier_available() {
        return Err("This build doesn't include the notification server.".into());
    }
    let server = Server::http(("0.0.0.0", port))
        .map_err(|e| format!("Couldn't start on port {}: {}", port, e))?;

    let relay_port = port.saturating_add(1);
    let mut child = None;
    let notifier_port = if notify {
        match spawn_notifier(INTERNAL_NOTIFIER_PORT, relay_port, telegram_token.as_deref(), telegram_passphrase.as_deref()) {
            Ok(c) => {
                child = Some(c);
                Some(INTERNAL_NOTIFIER_PORT)
            }
            Err(e) => return Err(format!("Couldn't start the notification server: {}", e)),
        }
    } else {
        None
    };

    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let asset_src = assets.0.clone();
    let handle = std::thread::Builder::new()
        .name("freeport-host".into())
        .spawn(move || serve_loop(server, stop2, notifier_port, asset_src))
        .map_err(|e| e.to_string())?;
    let telegram_on = notify
        && telegram_token.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    st.running = true;
    st.port = port;
    st.notify = notify;
    st.telegram = telegram_on;
    st.relay_port = relay_port;
    st.stop = Some(stop);
    st.handle = Some(handle);
    st.notifier = child;
    Ok(HostStatus {
        running: true,
        port,
        notify,
        telegram: telegram_on,
        notify_available: true,
        urls: local_urls(port),
        relay_urls: if notify { relay_urls(relay_port) } else { vec![] },
    })
}

#[tauri::command]
fn host_stop(state: State<'_, HostMutex>) -> Result<HostStatus, String> {
    let mut st = state.lock().map_err(|_| "internal lock error")?;
    if let Some(stop) = st.stop.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = st.handle.take() {
        let _ = handle.join();
    }
    if let Some(mut child) = st.notifier.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    st.running = false;
    st.notify = false;
    st.telegram = false;
    st.port = 0;
    st.relay_port = 0;
    Ok(HostStatus { running: false, port: 0, notify: false, telegram: false, notify_available: notifier_available(), urls: vec![], relay_urls: vec![] })
}

#[tauri::command]
fn host_status(state: State<'_, HostMutex>) -> HostStatus {
    let avail = notifier_available();
    match state.lock() {
        Ok(st) if st.running => HostStatus {
            running: true,
            port: st.port,
            notify: st.notify,
            telegram: st.telegram,
            notify_available: avail,
            urls: local_urls(st.port),
            relay_urls: if st.notify { relay_urls(st.relay_port) } else { vec![] },
        },
        _ => HostStatus { running: false, port: 0, notify: false, telegram: false, notify_available: avail, urls: vec![], relay_urls: vec![] },
    }
}

const DEFAULT_PORT: u16 = 1988;

fn flag_value(args: &[String], name: &str) -> Option<String> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == name {
            return it.next().cloned();
        }
        if let Some(v) = a.strip_prefix(&format!("{name}=")) {
            return Some(v.to_string());
        }
    }
    None
}

/// Headless: no GUI window — just run the static host server on `port` and
/// block until the process is killed (Ctrl-C). For always-on boxes (a Pi, a
/// VPS) that want to be a persistent Freeport distribution node. With `notify`,
/// also host the notification server on the same port.
fn run_headless(port: u16, notify: bool, tg_token: Option<String>, tg_passphrase: Option<String>, assets: AssetSource) {
    let server = match Server::http(("0.0.0.0", port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Freeport: couldn't bind port {port}: {e}");
            std::process::exit(1);
        }
    };
    let mut _notifier_child = None;
    let notifier_port = if notify {
        if !notifier_available() {
            eprintln!("Freeport: this build doesn't include the notification server (--notify unavailable).");
            std::process::exit(1);
        }
        match spawn_notifier(INTERNAL_NOTIFIER_PORT, port.saturating_add(1), tg_token.as_deref(), tg_passphrase.as_deref()) {
            Ok(c) => {
                _notifier_child = Some(c);
                Some(INTERNAL_NOTIFIER_PORT)
            }
            Err(e) => {
                eprintln!("Freeport: couldn't start the notification server: {e}");
                std::process::exit(1);
            }
        }
    } else {
        None
    };
    let tg_on = notify && tg_token.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    println!(
        "Freeport — hosting the web app{}{} on port {port}",
        if notify { " + notification/MCP server + relay" } else { "" },
        if tg_on { " + Telegram bridge" } else { "" },
    );
    let urls = local_urls(port);
    if urls.is_empty() {
        println!("  http://<this-machine-ip>:{port}  (no network interface detected)");
    } else {
        for u in &urls {
            println!("  {u}");
        }
    }
    if notify {
        println!("Relay (add to the app's relay list):");
        for u in relay_urls(port.saturating_add(1)) {
            println!("  {u}");
        }
    }
    println!("Anyone on your network can open one of those URLs. Press Ctrl-C to stop.");
    // Never-set stop flag → serves forever; Ctrl-C terminates the process.
    serve_loop(server, Arc::new(AtomicBool::new(false)), notifier_port, assets);
}

fn print_help() {
    println!(
        "Freeport desktop {}\n\n\
         USAGE:\n  freeport [--serve] [--port <PORT>]\n\n\
         Without arguments, opens the Freeport app window.\n\n\
         OPTIONS:\n  \
         --serve            Run headless: host the Freeport web app on your LAN, no window\n  \
         --port <PORT>      Port to host on (default {})\n  \
         --notify           Also host the notification/MCP server + a relay\n  \
         --telegram-token <T>              Run the Telegram bridge with this bot token (implies --notify)\n  \
         --telegram-guest-passphrase <P>   Enable custodial guest mode (advanced; holds keys for guests)\n  \
         -h, --help         Show this help\n  \
         -v, --version      Show version",
        env!("CARGO_PKG_VERSION"),
        DEFAULT_PORT
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        return;
    }
    if args.iter().any(|a| a == "-v" || a == "--version") {
        println!("freeport {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    // Build the Tauri context ONCE (embeds the web bundle a single time). Both
    // the GUI webview and our host server read from this one copy.
    let ctx = tauri::generate_context!();

    if args.iter().any(|a| a == "--serve" || a == "serve" || a == "--headless") {
        let port = flag_value(&args, "--port")
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);
        let tg_token = flag_value(&args, "--telegram-token");
        let tg_passphrase = flag_value(&args, "--telegram-guest-passphrase");
        // Telegram (and thus notify) implied when a bot token is given.
        let notify = args.iter().any(|a| a == "--notify" || a == "--notifications") || tg_token.is_some();
        // Headless has no AppHandle; read assets straight from the embedded
        // context (leaked to 'static — the process serves until killed).
        let ctx: &'static _ = Box::leak(Box::new(ctx));
        let assets: AssetSource = Arc::new(|key: &str| {
            ctx.assets()
                .get(&key.into())
                .map(|bytes| (bytes.to_vec(), content_type(key).to_string()))
        });
        run_headless(port, notify, tg_token, tg_passphrase, assets);
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(HostMutex::default())
        .setup(|app| {
            // GUI: serve the host from the AppHandle's asset resolver (same
            // single embedded copy the webview uses).
            let resolver = app.asset_resolver();
            let assets: AssetSource = Arc::new(move |key: &str| {
                resolver.get(key.to_string()).map(|a| (a.bytes, a.mime_type))
            });
            app.manage(Assets(assets));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![host_start, host_stop, host_status])
        .run(ctx)
        .expect("error while running Freeport desktop");
}
