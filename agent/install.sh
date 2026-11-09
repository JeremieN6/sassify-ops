#!/usr/bin/env bash
# Installe l'agent Sassify Ops (mesures du serveur -> onglet Serveurs) comme timer systemd, toutes les 60 s.
# A lancer UNE FOIS, en root, sur le VPS, apres le deploiement de pilotage :
#   bash /srv/saas/pilotage/agent/install.sh
# Idempotent : on peut le relancer (met a jour les fichiers et redemarre le timer).
#
# La cle d'envoi est copiee depuis le .env de pilotage (NUXT_INGEST_KEY) vers /etc/pilotage-agent.env (600),
# sans jamais l'afficher. Retour arriere : bash /srv/saas/pilotage/agent/uninstall.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "A lancer en root."; exit 1; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_SRC="${PILOTAGE_ENV:-$DIR/../.env}"
ENV_DST=/etc/pilotage-agent.env
URL="${OPS_URL:-https://pilotage.sassify.fr}"

[ -f "$ENV_SRC" ] || { echo "Fichier introuvable : $ENV_SRC"; exit 1; }
command -v python3 >/dev/null || { echo "python3 est requis."; exit 1; }
command -v systemctl >/dev/null || { echo "systemd est requis."; exit 1; }

KEY="$(grep -m1 '^NUXT_INGEST_KEY=' "$ENV_SRC" | cut -d= -f2- | tr -d '\r"' | tr -d "'")"
[ "${#KEY}" -gt 20 ] || { echo "NUXT_INGEST_KEY introuvable ou trop courte dans $ENV_SRC"; exit 1; }

umask 077
printf 'OPS_URL=%s\nOPS_INGEST_KEY=%s\n' "$URL" "$KEY" > "$ENV_DST"
chmod 600 "$ENV_DST"
unset KEY

install -m 644 "$DIR/pilotage-agent.service" /etc/systemd/system/pilotage-agent.service
install -m 644 "$DIR/pilotage-agent.timer" /etc/systemd/system/pilotage-agent.timer
systemctl daemon-reload
systemctl enable --now pilotage-agent.timer

echo "Agent installe. Premier envoi :"
systemctl start pilotage-agent.service || true
journalctl -u pilotage-agent.service -n 5 --no-pager || true
echo "Verification : systemctl list-timers pilotage-agent.timer"
