#!/usr/bin/env bash
# Retire l'agent Sassify Ops : arrete le timer, supprime les unites systemd et le fichier de cle. A lancer en root.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "A lancer en root."; exit 1; }

systemctl disable --now pilotage-agent.timer 2>/dev/null || true
systemctl stop pilotage-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/pilotage-agent.service /etc/systemd/system/pilotage-agent.timer /etc/pilotage-agent.env
systemctl daemon-reload
echo "Agent retire."
