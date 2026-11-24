#!/usr/bin/env python3
"""Family Hub local control service. Runs on the Pi at 127.0.0.1:8777; the kiosk page
(served from Cloudflare) calls it to drive what a browser can't: monitor backlight and
display power over DDC (ddcutil), and system volume (wpctl).
  GET /status                 -> {"brightness":78,"display":"on","volume":100}
  GET /brightness?v=5..100    -> ddcutil setvcp 10 v
  GET /display?v=on|off       -> ddcutil setvcp d6 1|4
  GET /volume?v=0..100        -> wpctl set-volume @DEFAULT_AUDIO_SINK@ v%
"""
import json, re, subprocess, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

LOCK = threading.Lock()
STATE = {"brightness": None, "display": "on", "volume": None}

def sh(*cmd, timeout=12):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

def ddc(*args):
    with LOCK:
        return sh("sudo", "-n", "ddcutil", "--sleep-multiplier", ".4", *args)

def read_brightness():
    r = ddc("getvcp", "10", "--brief")          # "VCP 10 C 78 100"
    m = re.search(r"VCP 10 C (\d+) (\d+)", r.stdout)
    return int(m.group(1)) if m else None

def read_volume():
    r = sh("wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@")
    m = re.search(r"Volume: ([\d.]+)", r.stdout)
    return round(float(m.group(1)) * 100) if m else None

class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self._send(204, {})
    def log_message(self, *a): pass
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query); v = (q.get("v") or [""])[0]
        try:
            if u.path == "/status":
                if STATE["brightness"] is None: STATE["brightness"] = read_brightness()
                STATE["volume"] = read_volume()
                return self._send(200, STATE)
            if u.path == "/brightness":
                n = max(5, min(100, int(v))); r = ddc("setvcp", "10", str(n))
                if r.returncode: return self._send(502, {"error": r.stderr.strip()[-200:]})
                STATE["brightness"] = n; return self._send(200, {"brightness": n})
            if u.path == "/display":
                on = v != "off"; r = ddc("setvcp", "d6", "1" if on else "4")
                if r.returncode: return self._send(502, {"error": r.stderr.strip()[-200:]})
                STATE["display"] = "on" if on else "off"; return self._send(200, {"display": STATE["display"]})
            if u.path == "/volume":
                n = max(0, min(100, int(v))); r = sh("wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{n}%")
                if r.returncode: return self._send(502, {"error": r.stderr.strip()[-200:]})
                STATE["volume"] = n; return self._send(200, {"volume": n})
            return self._send(404, {"error": "unknown"})
        except Exception as e:
            return self._send(500, {"error": str(e)[:200]})

if __name__ == "__main__":
    ddc("setvcp", "d6", "1")   # never boot into a dark screen
    ThreadingHTTPServer(("127.0.0.1", 8777), H).serve_forever()
