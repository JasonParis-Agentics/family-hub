#!/bin/bash
# Family Hub WiFi watchdog (root cron every 2 min, /etc/cron.d/hub-wifi-watchdog).
# wlan0 can't reach the router -> kick WiFi twice; still dead (~6 min) -> reboot, max 1 reboot/hour.
# Router answers but internet doesn't = ISP problem -> do nothing.
LOG=/var/log/hub-wifi-watchdog.log
STATE=/var/lib/hub-wifi-watchdog
mkdir -p "$STATE"
# NetworkManager connection to re-up; defaults to whatever wifi profile wlan0 uses
WIFI_CON="${WIFI_CON:-$(nmcli -t -f NAME,DEVICE con show | awk -F: '$2=="wlan0"{print $1; exit}')}"
[ -z "$WIFI_CON" ] && WIFI_CON="$(nmcli -t -f NAME,TYPE con show | awk -F: '$2 ~ /wireless/{print $1; exit}')"
log(){ echo "$(date -Is) $*" >> "$LOG"; }

up=$(cut -d. -f1 /proc/uptime)
[ "$up" -lt 180 ] && exit 0                     # let boot settle

gw=$(ip route show default dev wlan0 2>/dev/null | awk '/default/{print $3; exit}')
if [ -n "$gw" ] && ping -c2 -W3 -I wlan0 "$gw" >/dev/null 2>&1; then
  [ -f "$STATE/fails" ] && log "wifi ok again (gw $gw)"
  rm -f "$STATE/fails"; exit 0
fi

n=$(( $(cat "$STATE/fails" 2>/dev/null || echo 0) + 1 )); echo $n > "$STATE/fails"
log "no router (fail #$n, gw='${gw}', $(nmcli -t -f DEVICE,STATE dev | grep '^wlan0'))"

if [ $n -le 2 ]; then
  log "kicking wifi"
  nmcli radio wifi off; sleep 3; nmcli radio wifi on; sleep 5
  nmcli con up "$WIFI_CON" >/dev/null 2>&1 || true
  exit 0
fi

last=$(cat "$STATE/last-reboot" 2>/dev/null || echo 0); now=$(date +%s)
if [ $((now - last)) -gt 3600 ]; then
  log "still no router after $n checks -> reboot"
  echo $now > "$STATE/last-reboot"; rm -f "$STATE/fails"
  sync; /sbin/reboot
else
  log "last watchdog reboot <1h ago; kicking wifi instead"
  nmcli con up "$WIFI_CON" >/dev/null 2>&1 || true
fi
