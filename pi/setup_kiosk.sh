#!/usr/bin/env bash
# Family Hub kiosk setup — run ONCE on the Pi 5 over SSH:
#   ssh hub@familyhub.local "HUB_URL='https://your-hub.your-account.workers.dev/?kiosk=1' bash -s" < setup_kiosk.sh
# Turns a fresh Raspberry Pi OS (64-bit desktop, Bookworm or Trixie) into a
# full-screen Chromium kiosk pointed at the Family Hub, with auto-login,
# no screen blanking, no first-boot wizard, and a 4 a.m. nightly reboot.
set -euo pipefail
URL="${HUB_URL:?set HUB_URL, e.g. HUB_URL=https://your-hub.your-account.workers.dev/?kiosk=1}"
BASE="${URL%%\?*}"
ME="$(id -un)"; HOME_DIR="$(eval echo ~"$ME")"

echo "== apt"
sudo apt-get update -qq
if apt-cache show chromium >/dev/null 2>&1; then CHROME=chromium; else CHROME=chromium-browser; fi
command -v chromium >/dev/null || command -v chromium-browser >/dev/null || \
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$CHROME" >/dev/null   # skip if preinstalled (upgrade download is slow)
BIN="$(command -v chromium || command -v chromium-browser)"
# color emoji font: the hub's kid/chore icons render as boxes without it
fc-list | grep -qi emoji || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-noto-color-emoji >/dev/null

echo "== desktop auto-login, no blanking, no setup wizard"
sudo raspi-config nonint do_boot_behaviour B4      # desktop + auto-login
sudo raspi-config nonint do_blanking 1             # 1 = disable screen blanking
sudo raspi-config nonint do_boot_splash 0 || true  # splash on
sudo rm -f /etc/xdg/autostart/piwiz.desktop

echo "== kiosk launcher"
mkdir -p "$HOME_DIR/.config/labwc" "$HOME_DIR/.local/bin"
cat > "$HOME_DIR/.local/bin/hub-kiosk.sh" <<EOK
#!/usr/bin/env bash
# relaunch forever so a crash never leaves a bare desktop
URL="$URL"
BIN="$BIN"

# block until the hub URL actually answers (boot races WiFi + DNS; 10/29 the 4 AM
# reboot launched Chromium before wlan0 was up -> ERR_NAME_NOT_RESOLVED all morning)
wait_online() {
  # give Wi-Fi 90 s, then launch anyway: the service worker serves the last good copy offline (10/31 outage)
  for _ in \$(seq 30); do curl -sf --max-time 5 -o /dev/null "\$URL" && return; sleep 3; done
}

# watchdog: if the page is an error page (title != Family Hub) while the URL is
# reachable, kill chromium so the loop relaunches it onto the live page
(
  bad=0
  while true; do
    sleep 60
    title=\$(curl -s --max-time 3 http://127.0.0.1:9222/json 2>/dev/null \\
      | python3 -c 'import sys,json;print(next((t.get("title","") for t in json.load(sys.stdin) if t.get("type")=="page"),""))' 2>/dev/null)
    if [ -n "\$title" ] && [ "\$title" != "Family Hub" ] && curl -sf --max-time 5 -o /dev/null "\$URL"; then
      bad=\$((bad+1))
      if [ "\$bad" -ge 2 ]; then
        echo "\$(date -Is) hub-kiosk watchdog: title='\$title' -> relaunch" >> ~/hub-kiosk.log
        pkill -x chromium; bad=0
      fi
    else
      bad=0
    fi
  done
) &

while true; do
  wait_online
  "\$BIN" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
    --disable-features=TranslateUI,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights --remote-debugging-port=9222 --password-store=basic --check-for-update-interval=31536000 \\
    --touch-events=enabled --overscroll-history-navigation=0 --pull-to-refresh=0 \\
    --autoplay-policy=no-user-gesture-required --start-maximized \\
    "\$URL"
  sleep 3
done
EOK
#!/usr/bin/env bash
# relaunch forever so a crash never leaves a bare desktop
while true; do
  "$BIN" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
    --disable-features=TranslateUI,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights --remote-debugging-port=9222 --password-store=basic --check-for-update-interval=31536000 \\
    --touch-events=enabled --overscroll-history-navigation=0 --pull-to-refresh=0 \\
    --autoplay-policy=no-user-gesture-required --start-maximized \\
    "$URL"
  sleep 3
done
EOK
chmod +x "$HOME_DIR/.local/bin/hub-kiosk.sh"

# labwc (Pi 5 default Wayland session). Append once.
touch "$HOME_DIR/.config/labwc/autostart"
grep -q hub-kiosk "$HOME_DIR/.config/labwc/autostart" || \
  echo "$HOME_DIR/.local/bin/hub-kiosk.sh &" >> "$HOME_DIR/.config/labwc/autostart"
# wayfire fallback (older Bookworm images)
mkdir -p "$HOME_DIR/.config"
if [ -f "$HOME_DIR/.config/wayfire.ini" ] && ! grep -q hub-kiosk "$HOME_DIR/.config/wayfire.ini"; then
  printf '\n[autostart]\nhub = %s/.local/bin/hub-kiosk.sh\n' "$HOME_DIR" >> "$HOME_DIR/.config/wayfire.ini"
fi

echo "== wall controls (backlight / display power / volume over DDC + wpctl)"
command -v ddcutil >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ddcutil >/dev/null
# hub-local.py ships next to this script; copy it in by hand if the script was piped over ssh
[ -f "$(dirname "$0")/hub-local.py" ] && cp "$(dirname "$0")/hub-local.py" "$HOME_DIR/.local/bin/hub-local.py"
grep -q hub-local "$HOME_DIR/.config/labwc/autostart" || echo 'python3 ~/.local/bin/hub-local.py &' >> "$HOME_DIR/.config/labwc/autostart"

echo "== nightly reboot 4:00"
{ crontab -l 2>/dev/null | grep -v hub-reboot || true; echo "0 4 * * * curl -sf --max-time 10 -o /dev/null $BASE && sudo /sbin/reboot # hub-reboot (skipped when offline)"; } | crontab -

echo "== hdmi audio default"
sudo raspi-config nonint do_audio 0 2>/dev/null || true
# full output volume at every login (WirePlumber default is 40%)
grep -q "wpctl set-volume" "$HOME_DIR/.config/labwc/autostart" || echo 'sh -c "sleep 8; wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0" &' >> "$HOME_DIR/.config/labwc/autostart"

echo "done. rebooting into kiosk in 5s"; sleep 5; sudo reboot
