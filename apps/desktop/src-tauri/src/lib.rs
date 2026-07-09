//! Freeport desktop (Tauri v2).
//!
//! Ships the Freeport web bundle as a native window, plus an OPTIONAL built-in
//! host server: the user picks a port and Freeport serves the very same bundle
//! over HTTP on their LAN, so anyone on the network can open it in a browser —
//! a zero-infrastructure way to share/self-host Freeport when the store or
//! domain is unavailable. The served app still talks directly to the public
//! Nostr relays; this only distributes the client, it is not a relay or notifier.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use include_dir::{include_dir, Dir};
use serde::Serialize;
use tauri::State;
use tiny_http::{Header, Response, Server};

/// The web bundle, embedded at compile time. `apps/desktop/dist` is produced by
/// build-web.sh (tauri beforeBuildCommand) before the crate is compiled.
static WEB: Dir = include_dir!("$CARGO_MANIFEST_DIR/../dist");

#[derive(Default)]
struct HostState {
    running: bool,
    port: u16,
    stop: Option<Arc<AtomicBool>>,
    handle: Option<JoinHandle<()>>,
}

type HostMutex = Mutex<HostState>;

#[derive(Serialize, Clone)]
struct HostStatus {
    running: bool,
    port: u16,
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

fn serve_loop(server: Server, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::Relaxed) {
        match server.recv_timeout(Duration::from_millis(300)) {
            Ok(Some(req)) => {
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
fn host_start(state: State<'_, HostMutex>, port: u16) -> Result<HostStatus, String> {
    if port < 1024 {
        return Err("Please choose a port of 1024 or higher.".into());
    }
    let mut st = state.lock().map_err(|_| "internal lock error")?;
    if st.running {
        return Err(format!("Already hosting on port {}. Stop it first.", st.port));
    }
    let server = Server::http(("0.0.0.0", port))
        .map_err(|e| format!("Couldn't start on port {}: {}", port, e))?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let handle = std::thread::Builder::new()
        .name("freeport-host".into())
        .spawn(move || serve_loop(server, stop2))
        .map_err(|e| e.to_string())?;
    st.running = true;
    st.port = port;
    st.stop = Some(stop);
    st.handle = Some(handle);
    Ok(HostStatus { running: true, port, urls: local_urls(port) })
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
    st.running = false;
    let port = st.port;
    st.port = 0;
    Ok(HostStatus { running: false, port, urls: vec![] })
}

#[tauri::command]
fn host_status(state: State<'_, HostMutex>) -> HostStatus {
    match state.lock() {
        Ok(st) if st.running => HostStatus { running: true, port: st.port, urls: local_urls(st.port) },
        _ => HostStatus { running: false, port: 0, urls: vec![] },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(HostMutex::default())
        .invoke_handler(tauri::generate_handler![host_start, host_stop, host_status])
        .run(tauri::generate_context!())
        .expect("error while running Freeport desktop");
}
