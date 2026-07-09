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

use include_dir::{include_dir, Dir};
use serde::Serialize;
use tauri::State;
use tiny_http::{Header, Request, Response, Server};

/// Fixed loopback port the bundled notification-server sidecar binds to; the
/// public host server reverse-proxies notifier routes here.
const INTERNAL_NOTIFIER_PORT: u16 = 47615;

/// The web bundle, embedded at compile time. `apps/desktop/dist` is produced by
/// build-web.sh (tauri beforeBuildCommand) before the crate is compiled.
static WEB: Dir = include_dir!("$CARGO_MANIFEST_DIR/../dist");

#[derive(Default)]
struct HostState {
    running: bool,
    port: u16,
    notify: bool,
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
    /// True if a notifier sidecar is bundled in this build (feature available).
    notify_available: bool,
    /// Shareable URLs (one per non-loopback IPv4 interface) when running.
    urls: Vec<String>,
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

fn spawn_notifier(internal: u16) -> std::io::Result<Child> {
    let path = sidecar_path()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "notifier not bundled"))?;
    std::process::Command::new(path)
        .env("HOST", "127.0.0.1")
        .env("PORT", internal.to_string())
        .env("ENABLE_NOTIFY", "1")
        .env("DATA_DIR", notifier_data_dir())
        .env("VAPID_SUBJECT", "mailto:hi@freeport.network")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
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

/// Resolve a request path to an embedded file, with SPA fallback: a bare path
/// or an extension-less/unknown route serves index.html (Freeport is a single
/// page); a missing asset with an extension returns 404.
fn lookup(req_path: &str) -> Option<(&'static [u8], &'static str)> {
    let clean = req_path.split(['?', '#']).next().unwrap_or("").trim_start_matches('/');
    let clean = if clean.is_empty() { "index.html" } else { clean };
    if let Some(f) = WEB.get_file(clean) {
        return Some((f.contents(), content_type(clean)));
    }
    let looks_like_asset = clean.rsplit('/').next().map(|s| s.contains('.')).unwrap_or(false);
    if looks_like_asset {
        return None; // real missing asset → 404
    }
    WEB.get_file("index.html").map(|f| (f.contents(), content_type("index.html")))
}

fn serve_loop(server: Server, stop: Arc<AtomicBool>, notifier: Option<u16>) {
    while !stop.load(Ordering::Relaxed) {
        match server.recv_timeout(Duration::from_millis(300)) {
            Ok(Some(req)) => {
                if let Some(np) = notifier {
                    if is_notifier_path(req.url()) {
                        proxy_to_notifier(req, np);
                        continue;
                    }
                }
                let (body, ctype): (&[u8], &str) = match lookup(req.url()) {
                    Some(hit) => hit,
                    None => {
                        let _ = req.respond(Response::from_string("Not found").with_status_code(404));
                        continue;
                    }
                };
                let header = Header::from_bytes(&b"Content-Type"[..], ctype.as_bytes())
                    .unwrap_or_else(|_| Header::from_bytes(&b"Content-Type"[..], &b"application/octet-stream"[..]).unwrap());
                let resp = Response::new(200.into(), vec![header], Cursor::new(body), Some(body.len()), None);
                let _ = req.respond(resp);
            }
            Ok(None) => continue, // timeout → re-check stop flag
            Err(_) => break,
        }
    }
    // server drops here → port released
}

#[tauri::command]
fn host_start(state: State<'_, HostMutex>, port: u16, notify: bool) -> Result<HostStatus, String> {
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

    let mut child = None;
    let notifier_port = if notify {
        match spawn_notifier(INTERNAL_NOTIFIER_PORT) {
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
    let handle = std::thread::Builder::new()
        .name("freeport-host".into())
        .spawn(move || serve_loop(server, stop2, notifier_port))
        .map_err(|e| e.to_string())?;
    st.running = true;
    st.port = port;
    st.notify = notify;
    st.stop = Some(stop);
    st.handle = Some(handle);
    st.notifier = child;
    Ok(HostStatus { running: true, port, notify, notify_available: true, urls: local_urls(port) })
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
    st.port = 0;
    Ok(HostStatus { running: false, port: 0, notify: false, notify_available: notifier_available(), urls: vec![] })
}

#[tauri::command]
fn host_status(state: State<'_, HostMutex>) -> HostStatus {
    let avail = notifier_available();
    match state.lock() {
        Ok(st) if st.running => HostStatus { running: true, port: st.port, notify: st.notify, notify_available: avail, urls: local_urls(st.port) },
        _ => HostStatus { running: false, port: 0, notify: false, notify_available: avail, urls: vec![] },
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
fn run_headless(port: u16, notify: bool) {
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
        match spawn_notifier(INTERNAL_NOTIFIER_PORT) {
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
    println!("Freeport — hosting the web app{} on port {port}", if notify { " + notification server" } else { "" });
    let urls = local_urls(port);
    if urls.is_empty() {
        println!("  http://<this-machine-ip>:{port}  (no network interface detected)");
    } else {
        for u in &urls {
            println!("  {u}");
        }
    }
    println!("Anyone on your network can open one of those URLs. Press Ctrl-C to stop.");
    // Never-set stop flag → serves forever; Ctrl-C terminates the process.
    serve_loop(server, Arc::new(AtomicBool::new(false)), notifier_port);
}

fn print_help() {
    println!(
        "Freeport desktop {}\n\n\
         USAGE:\n  freeport [--serve] [--port <PORT>]\n\n\
         Without arguments, opens the Freeport app window.\n\n\
         OPTIONS:\n  \
         --serve            Run headless: host the Freeport web app on your LAN, no window\n  \
         --port <PORT>      Port to host on (default {})\n  \
         --notify           Also host the notification server on the same port\n  \
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
    if args.iter().any(|a| a == "--serve" || a == "serve" || a == "--headless") {
        let port = flag_value(&args, "--port")
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);
        let notify = args.iter().any(|a| a == "--notify" || a == "--notifications");
        run_headless(port, notify);
        return;
    }

    tauri::Builder::default()
        .manage(HostMutex::default())
        .invoke_handler(tauri::generate_handler![host_start, host_stop, host_status])
        .run(tauri::generate_context!())
        .expect("error while running Freeport desktop");
}
