#!/usr/bin/env python3
"""Agent Sassify Ops (pilotage) : mesures du serveur envoyees a l'onglet Serveurs.

Lecture seule, bibliotheque standard uniquement (Python 3). Lance toutes les 60 s par un timer systemd (voir install.sh).
Mesure : CPU, memoire, disque, debit reseau sortant (sur une fenetre de ~1 s), processus PM2.
Envoie le tout en JSON a POST {OPS_URL}/api/ingest/server avec l'en-tete x-ops-key.

Configuration (variables d'environnement, fichier /etc/pilotage-agent.env en 600) :
  OPS_URL           ex: https://pilotage.sassify.fr
  OPS_INGEST_KEY    la meme valeur que NUXT_INGEST_KEY cote pilotage
  PILOTAGE_HOST     (optionnel) nom de la machine ; par defaut le hostname en minuscules
  PM2_BIN           (optionnel) chemin de pm2 ; par defaut cherche dans le PATH puis /usr/bin/pm2
  PM2_EVERY_MIN     (optionnel) l'etat PM2 (la partie la plus couteuse : ~0,2 s de CPU) n'est lu qu'une minute sur N ; defaut 5

Regle d'or : ne jamais bruiter ni casser le serveur. Aucune ecriture hors stdout/stderr, aucun etat conserve,
un echec d'envoi est simplement journalise (le prochain passage reessaie).
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

SAMPLE_SECONDS = 1.0
HTTP_TIMEOUT = 10
SKIPPED_INTERFACE_PREFIXES = ("lo", "veth", "docker", "br-")


# ---------- fonctions pures (testees dans test_pilotage_agent.py) ----------

def parse_cpu_times(proc_stat_text):
    """Premiere ligne de /proc/stat -> (inactif, total) en ticks. Exclut les colonnes guest (deja comptees dans user/nice)."""
    for line in proc_stat_text.splitlines():
        if line.startswith("cpu "):
            fields = [int(value) for value in line.split()[1:9]]
            idle = fields[3] + (fields[4] if len(fields) > 4 else 0)  # idle + iowait
            return idle, sum(fields)
    raise ValueError("ligne 'cpu ' introuvable dans /proc/stat")


def cpu_percent(before, after):
    """Pourcentage d'utilisation entre deux mesures (inactif, total). None si aucune evolution."""
    total = after[1] - before[1]
    idle = after[0] - before[0]
    if total <= 0:
        return None
    return round(max(0.0, min(100.0, 100.0 * (1.0 - idle / total))), 1)


def parse_mem_percent(meminfo_text):
    """Memoire utilisee = (MemTotal - MemAvailable) / MemTotal."""
    values = {}
    for line in meminfo_text.splitlines():
        name, _, rest = line.partition(":")
        parts = rest.split()
        if parts:
            values[name.strip()] = int(parts[0])
    total = values.get("MemTotal")
    available = values.get("MemAvailable")
    if not total or available is None:
        raise ValueError("MemTotal / MemAvailable introuvables dans /proc/meminfo")
    return round(100.0 * (total - available) / total, 1)


def disk_percent(f_blocks, f_bfree, f_bavail):
    """Meme definition que df : utilise / (utilise + disponible pour un utilisateur normal)."""
    used = f_blocks - f_bfree
    denominator = used + f_bavail
    if denominator <= 0:
        return None
    return round(100.0 * used / denominator, 1)


def parse_net_tx_bytes(net_dev_text):
    """Total des octets emis (hors boucle locale, veth, docker, ponts) lu dans /proc/net/dev."""
    total = 0
    for line in net_dev_text.splitlines():
        if ":" not in line:
            continue
        name, _, rest = line.partition(":")
        name = name.strip()
        if not name or name.startswith(SKIPPED_INTERFACE_PREFIXES):
            continue
        columns = rest.split()
        if len(columns) >= 9:
            total += int(columns[8])
    return total


def net_mbps(bytes_before, bytes_after, seconds):
    """Debit sortant en Mb/s sur la fenetre. None si la fenetre ou le compteur est incoherent (compteur remis a zero)."""
    if seconds <= 0 or bytes_after < bytes_before:
        return None
    return round((bytes_after - bytes_before) * 8 / 1_000_000 / seconds, 3)


def humanize_uptime(seconds):
    seconds = int(seconds)
    if seconds < 0:
        return None
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes = rest // 60
    if days:
        return f"{days} j {hours} h"
    if hours:
        return f"{hours} h {minutes} min"
    return f"{minutes} min"


def extract_json_array(text):
    """pm2 peut afficher des lignes d'information avant le JSON, et elles commencent parfois elles-memes par '[' (ex: '[PM2] ...').
    On essaie chaque ligne candidate jusqu'a obtenir un tableau JSON valide."""
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if not line.lstrip().startswith("["):
            continue
        try:
            value = json.loads(chr(10).join(lines[index:]))
        except json.JSONDecodeError:
            continue
        if isinstance(value, list):
            return value
    raise ValueError("aucun tableau JSON dans la sortie de pm2")


def parse_pm2(jlist_text, now_ms):
    """Sortie de `pm2 jlist` -> liste de processus pour l'ecran (nom, CPU %, memoire Mo, redemarrages, uptime, statut)."""
    processes = []
    for item in extract_json_array(jlist_text):
        env = item.get("pm2_env") or {}
        monit = item.get("monit") or {}
        name = str(item.get("name") or "")[:80]
        if not name:
            continue
        process = {"name": name}
        if isinstance(monit.get("cpu"), (int, float)):
            process["cpu"] = round(float(monit["cpu"]), 1)
        if isinstance(monit.get("memory"), (int, float)):
            process["memMb"] = round(monit["memory"] / 1048576, 1)
        if isinstance(env.get("restart_time"), int):
            process["restarts"] = env["restart_time"]
        started = env.get("pm_uptime")
        if env.get("status") == "online" and isinstance(started, (int, float)):
            uptime = humanize_uptime((now_ms - started) / 1000)
            if uptime:
                process["uptime"] = uptime
        if env.get("status"):
            process["status"] = str(env["status"])[:20]
        processes.append(process)
    return processes[:80]


def should_collect_pm2(now_seconds, every_minutes):
    """Sans etat : l'etat PM2 n'est lu que lorsque la minute courante est un multiple de N (une fois sur N passages)."""
    if every_minutes <= 1:
        return True
    return int(now_seconds // 60) % every_minutes == 0


def build_payload(host, cpu, mem, disk, net, processes):
    payload = {
        "host": host,
        "cpuPct": cpu,
        "memPct": mem,
        "diskPct": disk,
        "netOutMbps": net,
    }
    if processes is not None:  # absent = non lu cette fois ; l'ecran garde la derniere liste connue
        payload["processes"] = processes
    return payload


# ---------- lecture du systeme et envoi ----------

def read_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def find_pm2():
    configured = os.environ.get("PM2_BIN")
    if configured:
        return configured
    return shutil.which("pm2") or "/usr/bin/pm2"


def collect_pm2():
    try:
        result = subprocess.run([find_pm2(), "jlist"], capture_output=True, text=True, timeout=20, check=False)
        return parse_pm2(result.stdout, time.time() * 1000)
    except Exception as error:  # pm2 absent ou en panne : le reste des mesures part quand meme
        print(f"pilotage-agent: pm2 indisponible ({error})", file=sys.stderr)
        return []


def collect(include_pm2):
    cpu_before = parse_cpu_times(read_file("/proc/stat"))
    net_before = parse_net_tx_bytes(read_file("/proc/net/dev"))
    started = time.monotonic()
    time.sleep(SAMPLE_SECONDS)
    cpu_after = parse_cpu_times(read_file("/proc/stat"))
    net_after = parse_net_tx_bytes(read_file("/proc/net/dev"))
    elapsed = time.monotonic() - started

    stat = os.statvfs("/")
    return {
        "cpu": cpu_percent(cpu_before, cpu_after),
        "mem": parse_mem_percent(read_file("/proc/meminfo")),
        "disk": disk_percent(stat.f_blocks, stat.f_bfree, stat.f_bavail),
        "net": net_mbps(net_before, net_after, elapsed),
        "processes": collect_pm2() if include_pm2 else None,
    }


def post(url, key, payload):
    request = urllib.request.Request(
        url.rstrip("/") + "/api/ingest/server",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", "x-ops-key": key},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return response.status


def main():
    url = os.environ.get("OPS_URL", "").strip()
    key = os.environ.get("OPS_INGEST_KEY", "").strip()
    if not url or not key:
        print("pilotage-agent: OPS_URL / OPS_INGEST_KEY manquantes, rien envoye", file=sys.stderr)
        return 2

    host = (os.environ.get("PILOTAGE_HOST") or socket.gethostname()).strip().lower()
    try:
        every = int(os.environ.get("PM2_EVERY_MIN", "5"))
    except ValueError:
        every = 5
    # --dry-run lit toujours PM2 (diagnostic) ; --with-pm2 force aussi la lecture.
    include_pm2 = "--dry-run" in sys.argv or "--with-pm2" in sys.argv or should_collect_pm2(time.time(), every)
    measures = collect(include_pm2)
    payload = build_payload(host, measures["cpu"], measures["mem"], measures["disk"], measures["net"], measures["processes"])

    if "--dry-run" in sys.argv:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    try:
        status = post(url, key, payload)
        print(f"pilotage-agent: envoye ({status}) cpu={payload['cpuPct']} mem={payload['memPct']} disque={payload['diskPct']} processus={len(payload['processes']) if 'processes' in payload else 'non lus'}")
        return 0
    except Exception as error:
        # Jamais le contenu de la reponse ni la cle : seulement le type d'erreur.
        print(f"pilotage-agent: envoi impossible ({type(error).__name__}: {error})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
