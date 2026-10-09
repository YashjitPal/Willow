#!/bin/sh
# Builds the base machine every dot's computer is copied from: Alpine Linux with
# a desktop, a browser, Node, Python and everyday tools; the unprivileged `dot`
# user the desktop, browser, commands and files run as; and WSL settings that
# keep the machine away from Windows. Runs once, as root, in a throwaway distro
# the companion then exports (../manager.mjs).
set -eu

say() { printf '%s\n' "willow-progress $*"; }

# The desktop's packages are also installed by the service on a machine made
# from an older base (service.mjs, DESKTOP_PACKAGES): keep the two lists alike.
PACKAGES="chromium nodejs npm python3 py3-pip
  xvfb xfce4 xfce4-terminal mousepad xdotool ffmpeg dbus dbus-x11 adwaita-icon-theme xfce4-docklike-plugin picom
  bash coreutils findutils grep sed gawk diffutils patch less file procps psmisc
  tar gzip xz bzip2 unzip zip
  curl wget ca-certificates git openssh-client jq ripgrep sqlite
  tzdata nftables sudo
  font-noto font-noto-cjk font-noto-emoji ttf-dejavu"

# Alpine's mirrors are briefly inconsistent while a release syncs; a fresh index a little later is enough.
attempt=1
while :; do
  say "packages $((attempt * 2))"
  # shellcheck disable=SC2086
  if apk update >/dev/null && apk add --no-cache $PACKAGES; then break; fi
  if [ "$attempt" -ge 4 ]; then exit 1; fi
  sleep $((attempt * 20))
  attempt=$((attempt + 1))
done
say "packages 90"

# The dot: no password, no root, a home with its workspace in it.
addgroup -g 61000 dot
adduser -D -u 61000 -G dot -s /bin/bash -h /home/dot dot
passwd -l root >/dev/null 2>&1 || true
mkdir -p /home/dot/workspace /home/dot/.config /home/dot/.local/bin /home/dot/.cache
chown -R dot:dot /home/dot
chmod 755 /home/dot

# The only thing the dot may do as root is install packages, through the wrapper
# the computer service writes at every start (service.mjs, installHelpers).
mkdir -p /usr/local/sbin /usr/local/bin /etc/sudoers.d

# No Windows drives, no Windows programs, and a neutral name on the network.
cat > /etc/wsl.conf <<'EOF'
[automount]
enabled = false
mountFsTab = false

[interop]
enabled = false
appendWindowsPath = false

[network]
hostname = willow
generateHosts = true
generateResolvConf = true

[user]
default = dot

[boot]
systemd = false
EOF

mkdir -p /opt/willow /var/lib/willow
chmod 700 /var/lib/willow
rm -rf /var/cache/apk/* /tmp/* /root/.cache 2>/dev/null || true
sync
say "packages 100"
echo "willow-base-ready"
