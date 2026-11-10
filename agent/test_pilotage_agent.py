"""Tests de l'agent (fonctions pures, aucun acces au systeme ni au reseau).
Lancer : python -m unittest agent/test_pilotage_agent.py   (depuis la racine du depot ops)
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pilotage_agent as agent  # noqa: E402

PROC_STAT = "cpu  1000 50 500 8000 200 10 20 5 99 0\ncpu0 500 25 250 4000 100 5 10 2 0 0\nintr 1\n"
MEMINFO = "MemTotal:       8000000 kB\nMemFree:         500000 kB\nMemAvailable:   2000000 kB\nBuffers:         100 kB\n"
NET_DEV = (
    "Inter-|   Receive                                                |  Transmit\n"
    " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n"
    "    lo: 999999 10 0 0 0 0 0 0 999999 10 0 0 0 0 0 0\n"
    "  eth0: 5000000 100 0 0 0 0 0 0 7000000 90 0 0 0 0 0 0\n"
    "docker0: 1000 1 0 0 0 0 0 0 5000 1 0 0 0 0 0 0\n"
    "veth12: 1000 1 0 0 0 0 0 0 6000 1 0 0 0 0 0 0\n"
)


class CpuTests(unittest.TestCase):
    def test_parse_cpu_times_uses_idle_plus_iowait_and_ignores_guest_columns(self):
        idle, total = agent.parse_cpu_times(PROC_STAT)
        self.assertEqual(idle, 8200)
        self.assertEqual(total, 1000 + 50 + 500 + 8000 + 200 + 10 + 20 + 5)

    def test_cpu_percent(self):
        self.assertEqual(agent.cpu_percent((100, 1000), (150, 1100)), 50.0)
        self.assertEqual(agent.cpu_percent((100, 1000), (200, 1100)), 0.0)
        self.assertEqual(agent.cpu_percent((100, 1000), (100, 1100)), 100.0)
        self.assertIsNone(agent.cpu_percent((100, 1000), (100, 1000)))

    def test_missing_cpu_line_raises(self):
        with self.assertRaises(ValueError):
            agent.parse_cpu_times("intr 1\n")


class MemoryDiskTests(unittest.TestCase):
    def test_mem_percent(self):
        self.assertEqual(agent.parse_mem_percent(MEMINFO), 75.0)

    def test_mem_requires_available(self):
        with self.assertRaises(ValueError):
            agent.parse_mem_percent("MemTotal: 100 kB\n")

    def test_disk_percent_matches_df_definition(self):
        # df : utilise / (utilise + disponible) ; les blocs reserves a root ne comptent pas comme libres.
        self.assertEqual(agent.disk_percent(1000, 400, 350), round(100 * 600 / 950, 1))
        self.assertIsNone(agent.disk_percent(0, 0, 0))


class NetworkTests(unittest.TestCase):
    def test_tx_bytes_skip_loopback_docker_and_veth(self):
        self.assertEqual(agent.parse_net_tx_bytes(NET_DEV), 7000000)

    def test_mbps(self):
        self.assertEqual(agent.net_mbps(0, 1_250_000, 1.0), 10.0)
        self.assertEqual(agent.net_mbps(0, 625_000, 0.5), 10.0)

    def test_mbps_is_none_when_counter_resets_or_window_invalid(self):
        self.assertIsNone(agent.net_mbps(5000, 100, 1.0))
        self.assertIsNone(agent.net_mbps(0, 100, 0))


class Pm2Tests(unittest.TestCase):
    NOW_MS = 1_800_000_000_000

    def jlist(self):
        return json.dumps([
            {"name": "web", "pm2_env": {"status": "online", "restart_time": 3, "pm_uptime": self.NOW_MS - (2 * 86400 + 5 * 3600) * 1000}, "monit": {"cpu": 1.26, "memory": 104857600}},
            {"name": "worker", "pm2_env": {"status": "errored", "restart_time": 15, "pm_uptime": self.NOW_MS - 1000}, "monit": {"cpu": 0, "memory": 0}},
            {"name": "", "pm2_env": {}, "monit": {}},
        ])

    def test_parse_pm2(self):
        processes = agent.parse_pm2(self.jlist(), self.NOW_MS)
        self.assertEqual(len(processes), 2)
        self.assertEqual(processes[0], {"name": "web", "cpu": 1.3, "memMb": 100.0, "restarts": 3, "uptime": "2 j 5 h", "status": "online"})
        # un processus en erreur n'a pas d'uptime : il ne tourne pas
        self.assertEqual(processes[1], {"name": "worker", "cpu": 0.0, "memMb": 0.0, "restarts": 15, "status": "errored"})

    def test_banner_before_json_is_ignored(self):
        text = "[PM2] Spawning PM2 daemon with pm2_home=/root/.pm2\n[PM2] PM2 Successfully daemonized\n" + self.jlist()
        self.assertEqual(len(agent.parse_pm2(text, self.NOW_MS)), 2)

    def test_no_json_raises(self):
        with self.assertRaises(ValueError):
            agent.parse_pm2("rien ici", self.NOW_MS)

    def test_humanize_uptime(self):
        self.assertEqual(agent.humanize_uptime(30), "0 min")
        self.assertEqual(agent.humanize_uptime(3 * 3600 + 120), "3 h 2 min")
        self.assertEqual(agent.humanize_uptime(86400 + 7200), "1 j 2 h")
        self.assertIsNone(agent.humanize_uptime(-1))


class PayloadTests(unittest.TestCase):
    def test_payload_shape_matches_the_ingest_schema(self):
        payload = agent.build_payload("srv1", 12.5, 60.0, 47.0, 0.4, [{"name": "web"}])
        self.assertEqual(set(payload), {"host", "cpuPct", "memPct", "diskPct", "netOutMbps", "processes"})
        self.assertEqual(payload["host"], "srv1")

    def test_processes_key_is_absent_when_pm2_was_not_read(self):
        payload = agent.build_payload("srv1", 1.0, 2.0, 3.0, 0.1, None)
        self.assertNotIn("processes", payload)
        self.assertEqual(agent.build_payload("srv1", 1.0, 2.0, 3.0, 0.1, [])["processes"], [])


class Pm2ScheduleTests(unittest.TestCase):
    def test_reads_pm2_once_every_n_minutes(self):
        hits = [m for m in range(60) if agent.should_collect_pm2(m * 60 + 17, 5)]
        self.assertEqual(hits, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])

    def test_every_one_minute_or_less_always_reads(self):
        self.assertTrue(all(agent.should_collect_pm2(m * 60, 1) for m in range(10)))
        self.assertTrue(agent.should_collect_pm2(61, 0))


if __name__ == "__main__":
    unittest.main()
