#!/usr/bin/env python3
"""
Analyze sing-box side-router logs for direct outbound timeouts (Plan A).

All runtime outputs live under this directory (analyze-direct-timeouts/):

  reports/proxy-ips.txt              — full proxy-ips.txt (GitHub base + auto-added /24)
  reports/proxy-ips.additions-*.txt  — new /24 blocks added this run only
  reports/history.json               — processed IP / CIDR history across runs
  reports/geoip-cache.json           — GeoIP lookup cache
  reports/YYYY-MM-DD.{json,txt}      — human-readable report
  reports/latest.{json,txt}

Does NOT git commit or push. Copy reports/proxy-ips.txt to Mac → review → npm run publish.

Usage:
  python3 analyze-direct-timeouts/analyze.py --since 24h
  python3 analyze-direct-timeouts/analyze.py --log-file fixtures/sample.log --report-only
  npm run analyze-logs
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parent
DEFAULT_OUTPUT_DIR = TOOL_DIR / "reports"

IPV4_RE = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b")

DIRECT_TIMEOUT_RE = re.compile(
    r"direct(?:\[direct\])?.*?(?:i/o timeout|timeout|deadline exceeded)",
    re.IGNORECASE,
)
TIMEOUT_DIRECT_RE = re.compile(
    r"(?:i/o timeout|timeout|deadline exceeded).*?direct(?:\[direct\])?",
    re.IGNORECASE,
)

DEFAULT_PROXY_IPS_URL = (
    "https://raw.githubusercontent.com/zen-li/sing-box-rules/main/sources/proxy-ips.txt"
)
IP_API_BATCH = "http://ip-api.com/batch?fields=status,country,countryCode,query"
IP_API_BATCH_SIZE = 100
IP_API_PAUSE_SEC = 1.5
HISTORY_VERSION = 2
DEFAULT_PREFIX_LEN = 24

SKIP_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
]

# Skip resolver IPs in logs — never aggregate these into proxy-ips proposals
KNOWN_DNS_IPV4 = frozenset(
    {
        "8.8.8.8",
        "8.8.4.4",
        "1.1.1.1",
        "1.0.0.1",
        "9.9.9.9",
        "119.29.29.29",
        "223.5.5.5",
        "223.6.6.6",
        "114.114.114.114",
    }
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Analyze direct-timeout logs; produce full proxy-ips.txt + history (Plan A)."
    )
    p.add_argument("--container", default="sing-box-side-router")
    p.add_argument("--since", default="24h")
    p.add_argument("--log-file", help="Read logs from file instead of docker logs")
    p.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    p.add_argument("--proxy-ips-file", help="Local proxy-ips.txt base (overrides URL)")
    p.add_argument("--proxy-ips-url", default=DEFAULT_PROXY_IPS_URL)
    p.add_argument("--min-hits", type=int, default=3)
    p.add_argument(
        "--prefix-len",
        type=int,
        default=DEFAULT_PREFIX_LEN,
        help=f"Aggregate timeout IPs to this prefix length (default: {DEFAULT_PREFIX_LEN}, use /24 not /16)",
    )
    p.add_argument("--cache-file", default="", help="GeoIP cache (default: <output-dir>/geoip-cache.json)")
    p.add_argument("--history-file", default="", help="History JSON (default: <output-dir>/history.json)")
    p.add_argument(
        "--country-skip",
        default="CN,HK,MO",
        help="Comma-separated ISO country codes to skip (default: CN,HK,MO)",
    )
    p.add_argument(
        "--report-only",
        action="store_true",
        help="Do not write proxy-ips.txt; only JSON/TXT report",
    )
    return p.parse_args()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_date() -> str:
    return utc_now().strftime("%Y-%m-%d")


def utc_iso() -> str:
    return utc_now().isoformat()


def fetch_logs(container: str, since: str, log_file: Optional[str]) -> str:
    if log_file:
        return Path(log_file).read_text(encoding="utf-8", errors="replace")
    cmd = ["docker", "logs", container, "--since", since]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        sys.exit("ERROR: docker not found. Use --log-file for offline analysis.")
    if proc.returncode != 0 and not proc.stdout and not proc.stderr:
        sys.exit(f"ERROR: docker logs failed for container '{container}' (exit {proc.returncode})")
    return proc.stdout + proc.stderr


def is_direct_timeout_line(line: str) -> bool:
    if "direct" not in line.lower():
        return False
    if not re.search(r"(?:i/o timeout|timeout|deadline exceeded)", line, re.IGNORECASE):
        return False
    if "outbound/proxy" in line.lower() or "proxy[proxy]" in line.lower():
        return False
    return bool(DIRECT_TIMEOUT_RE.search(line) or TIMEOUT_DIRECT_RE.search(line))


def should_skip_ip(ip: ipaddress.IPv4Address) -> bool:
    return any(ip in net for net in SKIP_NETWORKS)


def extract_timeout_ips(log_text: str) -> Counter:
    counts: Counter = Counter()
    for line in log_text.splitlines():
        if not is_direct_timeout_line(line):
            continue
        for match in IPV4_RE.findall(line):
            try:
                ip = ipaddress.IPv4Address(match)
            except ipaddress.AddressValueError:
                continue
            if should_skip_ip(ip):
                continue
            counts[str(ip)] += 1
    return counts


def load_proxy_ips_text(proxy_ips_file: Optional[str], proxy_ips_url: str) -> str:
    if proxy_ips_file:
        return Path(proxy_ips_file).read_text(encoding="utf-8")
    req = urllib.request.Request(proxy_ips_url, headers={"User-Agent": "sing-box-rules-analyze/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: failed to fetch proxy-ips.txt: {e}")


def parse_cidr_networks(text: str) -> List[ipaddress.IPv4Network]:
    networks: List[ipaddress.IPv4Network] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            net = ipaddress.ip_network(line, strict=False)
        except ValueError:
            continue
        if isinstance(net, ipaddress.IPv4Network):
            networks.append(net)
    return networks


def ip_to_block(ip_str: str, prefix_len: int = DEFAULT_PREFIX_LEN) -> str:
    return str(ipaddress.ip_network(f"{ip_str}/{prefix_len}", strict=False))


def is_ip_covered(ip_str: str, networks: Iterable[ipaddress.IPv4Network]) -> bool:
    ip = ipaddress.IPv4Address(ip_str)
    return any(ip in net for net in networks)


def is_block_covered(cidr_block: str, networks: Iterable[ipaddress.IPv4Network]) -> bool:
    block = ipaddress.ip_network(cidr_block)
    return any(block.subnet_of(net) or block == net for net in networks)


def is_skip_ip(ip_str: str) -> bool:
    return ip_str in KNOWN_DNS_IPV4


def normalize_history(history: dict, prefix_len: int = DEFAULT_PREFIX_LEN) -> int:
    """Drop legacy cidr16 history and any block coarser than prefix_len (e.g. old /16)."""
    removed = 0
    legacy = history.pop("cidr16", None)
    if legacy:
        removed += len(legacy)

    blocks = history.setdefault("cidr_blocks", {})
    for cidr in list(blocks.keys()):
        try:
            if ipaddress.ip_network(cidr).prefixlen < prefix_len:
                del blocks[cidr]
                removed += 1
        except ValueError:
            del blocks[cidr]
            removed += 1

    history["version"] = HISTORY_VERSION
    history["prefix_len"] = prefix_len
    return removed


def load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def empty_history(prefix_len: int = DEFAULT_PREFIX_LEN) -> dict:
    return {
        "version": HISTORY_VERSION,
        "prefix_len": prefix_len,
        "updated_at": utc_iso(),
        "seen_ips": {},
        "cidr_blocks": {},
        "runs": [],
    }


def load_history(path: Path, prefix_len: int = DEFAULT_PREFIX_LEN) -> dict:
    data = load_json(path)
    if not data:
        return empty_history(prefix_len)
    data.setdefault("seen_ips", {})
    data.setdefault("cidr_blocks", {})
    data.setdefault("runs", [])
    return data


def lookup_geo_batch(ips: List[str], cache: Dict[str, dict]) -> Dict[str, dict]:
    result = {ip: cache[ip] for ip in ips if ip in cache}
    missing = [ip for ip in ips if ip not in cache]
    for i in range(0, len(missing), IP_API_BATCH_SIZE):
        chunk = missing[i : i + IP_API_BATCH_SIZE]
        body = json.dumps([{"query": ip, "fields": "status,country,countryCode,query"} for ip in chunk]).encode(
            "utf-8"
        )
        req = urllib.request.Request(
            IP_API_BATCH,
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "sing-box-rules-analyze/1.0"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                rows = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            sys.exit(f"ERROR: GeoIP lookup failed: {e}")
        for row in rows:
            if row.get("status") != "success":
                continue
            ip = row.get("query")
            if ip:
                entry = {"country": row.get("country"), "countryCode": row.get("countryCode")}
                cache[ip] = entry
                result[ip] = entry
        if i + IP_API_BATCH_SIZE < len(missing):
            time.sleep(IP_API_PAUSE_SEC)
    return result


def update_seen_ips(
    history: dict, ip_counts: Counter, geo: Dict[str, dict], today: str, prefix_len: int
) -> None:
    seen = history["seen_ips"]
    for ip, hits in ip_counts.items():
        info = geo.get(ip, {})
        if ip in seen:
            seen[ip]["last_seen"] = today
            seen[ip]["total_hits"] = seen[ip].get("total_hits", 0) + hits
        else:
            seen[ip] = {
                "first_seen": today,
                "last_seen": today,
                "total_hits": hits,
                "country": info.get("country"),
                "countryCode": info.get("countryCode"),
                "cidr_block": ip_to_block(ip, prefix_len),
            }


def parse_country_skip(value: str) -> set[str]:
    return {code.strip().upper() for code in value.split(",") if code.strip()}


def build_analysis(
    ip_counts: Counter,
    networks: List[ipaddress.IPv4Network],
    geo: Dict[str, dict],
    history: dict,
    min_hits: int,
    country_skip: set[str],
    prefix_len: int,
) -> dict:
    by_block: Dict[str, dict] = defaultdict(lambda: {"ips": Counter(), "hits": 0, "countries": set()})
    stale_rules: List[dict] = []
    skipped_country: List[dict] = []
    skipped_dns: List[dict] = []
    skipped_no_geo: List[str] = []

    for ip, count in ip_counts.items():
        if is_skip_ip(ip):
            skipped_dns.append({"ip": ip, "hits": count, "reason": "dns_resolver"})
            continue
        info = geo.get(ip)
        if not info:
            skipped_no_geo.append(ip)
            continue
        cc = (info.get("countryCode") or "").upper()
        if cc in country_skip:
            skipped_country.append(
                {"ip": ip, "hits": count, "country": info.get("country"), "countryCode": cc}
            )
            continue

        cidr_block = ip_to_block(ip, prefix_len)
        by_block[cidr_block]["ips"][ip] += count
        by_block[cidr_block]["hits"] += count
        by_block[cidr_block]["countries"].add(cc)

        if is_ip_covered(ip, networks):
            stale_rules.append(
                {
                    "ip": ip,
                    "hits": count,
                    "country": info.get("country"),
                    "countryCode": cc,
                    "cidr_block": cidr_block,
                    "action": "ruleset_stale",
                }
            )

    proposals: List[dict] = []
    below_threshold: List[dict] = []
    already_listed: List[dict] = []
    previously_added: List[dict] = []

    hist_blocks = history.get("cidr_blocks", {})

    for cidr_block, data in sorted(by_block.items()):
        hits = data["hits"]
        countries = sorted(data["countries"])
        sample_ips = [ip for ip, _ in data["ips"].most_common(5)]
        covered = is_block_covered(cidr_block, networks)
        hist = hist_blocks.get(cidr_block, {})
        hist_status = hist.get("status")

        entry = {
            "cidr_block": cidr_block,
            "hits": hits,
            "countries": countries,
            "sample_ips": sample_ips,
        }

        if covered:
            entry["action"] = "already_listed"
            already_listed.append(entry)
        elif hist_status == "added":
            entry["action"] = "previously_added"
            entry["added_at"] = hist.get("added_at")
            previously_added.append(entry)
        elif hits >= min_hits:
            entry["action"] = "propose_add"
            proposals.append(entry)
        else:
            entry["action"] = "below_threshold"
            below_threshold.append(entry)

    return {
        "generated_at": utc_iso(),
        "prefix_len": prefix_len,
        "summary": {
            "unique_timeout_ips": len(ip_counts),
            "non_cn_blocks": len(by_block),
            "propose_add": len(proposals),
            "new_additions_this_run": 0,
            "already_listed": len(already_listed),
            "previously_added": len(previously_added),
            "below_threshold": len(below_threshold),
            "ruleset_stale": len(stale_rules),
            "skipped_country_ips": len(skipped_country),
            "skipped_dns_ips": len(skipped_dns),
            "country_skip": sorted(country_skip),
        },
        "propose_add": proposals,
        "already_listed": already_listed,
        "previously_added": previously_added,
        "below_threshold": below_threshold,
        "ruleset_stale": stale_rules,
        "skipped_country": skipped_country,
        "skipped_dns": skipped_dns,
        "skipped_no_geo": skipped_no_geo,
    }


def append_cidr_blocks(base_text: str, additions: List[dict], today: str) -> Tuple[str, List[str]]:
    """Append new CIDR blocks (default /24); return (full text, list of cidr added)."""
    if not additions:
        return base_text.rstrip() + "\n", []

    lines = base_text.rstrip().splitlines()
    networks = parse_cidr_networks(base_text)
    added: List[str] = []

    for item in additions:
        cidr_block = item["cidr_block"]
        if is_block_covered(cidr_block, networks):
            continue
        countries = ",".join(item.get("countries") or [])
        samples = ",".join(item.get("sample_ips") or [])[:120]
        lines.append("")
        lines.append(f"# Auto-detected {today} hits={item['hits']} countries={countries} samples={samples}")
        lines.append(cidr_block)
        networks.append(ipaddress.ip_network(cidr_block))
        added.append(cidr_block)

    return "\n".join(lines).rstrip() + "\n", added


def update_history_blocks(history: dict, report: dict, added: List[str], today: str) -> None:
    cidr_hist = history["cidr_blocks"]

    def touch(cidr_block: str, status: str, hits: int, countries: List[str], sample_ips: List[str]) -> None:
        if cidr_block not in cidr_hist:
            cidr_hist[cidr_block] = {
                "first_seen": today,
                "last_seen": today,
                "total_hits": hits,
                "countries": countries,
                "sample_ips": sample_ips,
                "status": status,
            }
        else:
            cidr_hist[cidr_block]["last_seen"] = today
            cidr_hist[cidr_block]["total_hits"] = cidr_hist[cidr_block].get("total_hits", 0) + hits
            cidr_hist[cidr_block]["status"] = status
            existing = set(cidr_hist[cidr_block].get("countries") or [])
            cidr_hist[cidr_block]["countries"] = sorted(existing | set(countries))

    for item in report.get("propose_add", []):
        status = "added" if item["cidr_block"] in added else "propose_add"
        touch(item["cidr_block"], status, item["hits"], item["countries"], item["sample_ips"])
        if item["cidr_block"] in added:
            cidr_hist[item["cidr_block"]]["added_at"] = today

    for key in ("already_listed", "below_threshold", "previously_added"):
        for item in report.get(key, []):
            touch(
                item["cidr_block"],
                item["action"],
                item["hits"],
                item.get("countries") or [],
                item.get("sample_ips") or [],
            )

    for item in report.get("ruleset_stale", []):
        block = item["cidr_block"]
        if block not in cidr_hist:
            cidr_hist[block] = {
                "first_seen": today,
                "last_seen": today,
                "total_hits": item["hits"],
                "status": "ruleset_stale",
                "sample_ips": [item["ip"]],
            }
        else:
            cidr_hist[block]["last_seen"] = today
            cidr_hist[block]["total_hits"] = cidr_hist[block].get("total_hits", 0) + item["hits"]
            if cidr_hist[block].get("status") not in ("added",):
                cidr_hist[block]["status"] = "ruleset_stale"


def merge_prior_additions(base_text: str, history: dict, networks: List[ipaddress.IPv4Network]) -> str:
    """Re-apply blocks marked added in history but missing from upstream base."""
    extra: List[dict] = []
    for cidr_block, meta in history.get("cidr_blocks", {}).items():
        if meta.get("status") != "added":
            continue
        if is_block_covered(cidr_block, networks):
            continue
        extra.append(
            {
                "cidr_block": cidr_block,
                "hits": meta.get("total_hits", 0),
                "countries": meta.get("countries") or [],
                "sample_ips": meta.get("sample_ips") or [],
            }
        )
    if not extra:
        return base_text.rstrip() + "\n"
    merged, _ = append_cidr_blocks(base_text, extra, "history")
    return merged


def format_text_report(report: dict, min_hits: int, outputs: dict) -> str:
    s = report["summary"]
    lines = [
        "sing-box direct timeout analysis (Plan A)",
        f"Generated: {report['generated_at']}",
        "",
        "Summary",
        f"  Unique timeout IPs (filtered): {s['unique_timeout_ips']}",
        f"  Prefix length: /{report.get('prefix_len', DEFAULT_PREFIX_LEN)}",
        f"  New blocks added this run: {s['new_additions_this_run']}",
        f"  Propose add (>= {min_hits} hits): {s['propose_add']}",
        f"  Already in upstream proxy-ips.txt: {s['already_listed']}",
        f"  Previously added (in local history): {s['previously_added']}",
        f"  Below threshold: {s['below_threshold']}",
        f"  Ruleset stale: {s['ruleset_stale']}",
        f"  Skipped country IPs ({','.join(s.get('country_skip', ['CN', 'HK']))}): {s['skipped_country_ips']}",
        "",
        "Output files",
        f"  proxy-ips.txt: {outputs.get('proxy_ips', '(not written — report-only)')}",
        f"  additions:     {outputs.get('additions', '(none)')}",
        f"  history:       {outputs.get('history')}",
        f"  geoip cache:   {outputs.get('geoip_cache')}",
        "",
    ]

    if report.get("added_this_run"):
        lines.append(">>> ADDED THIS RUN")
        for cidr in report["added_this_run"]:
            lines.append(f"  {cidr}")
        lines.append("")

    if report["propose_add"] and not report.get("added_this_run"):
        lines.append(">>> PROPOSE ADD (pending — below threshold or report-only)")
        for item in report["propose_add"]:
            lines.append(f"  {item['cidr_block']}  hits={item['hits']}  countries={','.join(item['countries'])}")
        lines.append("")

    if report["ruleset_stale"]:
        lines.append(">>> RULESET STALE — covered in proxy-ips.txt but still direct-timeout")
        for item in report["ruleset_stale"][:15]:
            lines.append(f"  {item['ip']} ({item['countryCode']}) hits={item['hits']}  {item['cidr_block']}")
        lines.append("  Hint: restart side-router or clear cache.db (update_interval 1h)")
        lines.append("")

    lines.extend(
        [
            "Next steps (Mac):",
            "  1. scp ubuntu:.../analyze-direct-timeouts/reports/proxy-ips.txt .",
            "  2. Diff against sources/proxy-ips.txt, merge if OK",
            "  3. npm run publish",
            "",
        ]
    )
    return "\n".join(lines)


def write_reports(output_dir: Path, report: dict, text: str) -> None:
    date_str = utc_date()
    (output_dir / f"{date_str}.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output_dir / f"{date_str}.txt").write_text(text, encoding="utf-8")
    (output_dir / "latest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output_dir / "latest.txt").write_text(text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    cache_file = Path(args.cache_file) if args.cache_file else output_dir / "geoip-cache.json"
    history_file = Path(args.history_file) if args.history_file else output_dir / "history.json"
    proxy_ips_out = output_dir / "proxy-ips.txt"
    today = utc_date()

    print(f"Reading logs (container={args.container}, since={args.since})...")
    log_text = fetch_logs(args.container, args.since, args.log_file)
    ip_counts = extract_timeout_ips(log_text)
    print(f"Found {len(ip_counts)} unique IPs in direct-timeout lines")

    prefix_len = args.prefix_len
    if not 8 <= prefix_len <= 32:
        raise SystemExit(f"--prefix-len must be 8..32, got {prefix_len}")

    history = load_history(history_file, prefix_len)
    purged = normalize_history(history, prefix_len)
    if purged:
        print(f"Purged {purged} legacy/coarse history entries (using /{prefix_len})")
    geo_cache = load_json(cache_file)

    print("Loading upstream proxy-ips.txt...")
    base_text = load_proxy_ips_text(args.proxy_ips_file, args.proxy_ips_url)
    networks = parse_cidr_networks(base_text)

    # Restore prior server-side additions not yet merged upstream
    base_text = merge_prior_additions(base_text, history, networks)
    networks = parse_cidr_networks(base_text)

    outputs = {
        "history": str(history_file),
        "geoip_cache": str(cache_file),
        "proxy_ips": str(proxy_ips_out) if not args.report_only else None,
        "additions": None,
    }

    if not ip_counts:
        report = {
            "generated_at": utc_iso(),
            "summary": {"unique_timeout_ips": 0, "new_additions_this_run": 0, "propose_add": 0},
            "propose_add": [],
            "added_this_run": [],
            "note": "No direct-timeout IPs in log window",
        }
        if not args.report_only:
            proxy_ips_out.write_text(base_text, encoding="utf-8")
        write_reports(output_dir, report, format_text_report(report, args.min_hits, outputs))
        print("No timeout IPs; proxy-ips.txt unchanged.")
        return

    print(f"GeoIP lookup ({len(ip_counts)} IPs)...")
    geo = lookup_geo_batch(list(ip_counts.keys()), geo_cache)
    save_json(cache_file, geo_cache)

    country_skip = parse_country_skip(args.country_skip)
    update_seen_ips(history, ip_counts, geo, today, prefix_len)
    report = build_analysis(
        ip_counts, networks, geo, history, args.min_hits, country_skip, prefix_len
    )

    added_this_run: List[str] = []
    additions_path: Optional[Path] = None

    if not args.report_only:
        full_text, added_this_run = append_cidr_blocks(base_text, report["propose_add"], today)
        proxy_ips_out.write_text(full_text, encoding="utf-8")
        outputs["proxy_ips"] = str(proxy_ips_out)

        if added_this_run:
            additions_path = output_dir / f"proxy-ips.additions-{today}.txt"
            additions_path.write_text("\n".join(added_this_run) + "\n", encoding="utf-8")
            outputs["additions"] = str(additions_path)

    report["added_this_run"] = added_this_run
    report["summary"]["new_additions_this_run"] = len(added_this_run)

    update_history_blocks(history, report, added_this_run, today)
    history["updated_at"] = utc_iso()
    history["runs"].append(
        {
            "date": today,
            "since": args.since,
            "prefix_len": prefix_len,
            "unique_ips": len(ip_counts),
            "added": added_this_run,
            "propose_add": [p["cidr_block"] for p in report["propose_add"]],
        }
    )
    history["runs"] = history["runs"][-90:]
    save_json(history_file, history)

    text = format_text_report(report, args.min_hits, outputs)
    write_reports(output_dir, report, text)
    print(text)
    print(f"Written: {proxy_ips_out if not args.report_only else '(report-only)'}, {history_file}")


if __name__ == "__main__":
    main()
