#!/usr/bin/env python3

from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import argparse
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]

WORKERS = {
    "weather": {
        "label": "Weather worker",
        "cwd": ROOT / "workers" / "weather-refresh",
        "port": 8787,
        "object_path": "/var/weather.json",
        "vars": [
            "ENVIRONMENT:local",
            "WEATHER_OBJECT_KEY:var/weather.json",
        ],
    },
    "events": {
        "label": "Events worker",
        "cwd": ROOT / "workers" / "events-refresh",
        "port": 8788,
        "object_path": "/var/events7day.json",
        "vars": [
            "ENVIRONMENT:local",
            "EVENTS_OBJECT_KEY:var/events7day.json",
        ],
    },
}


def worker_url(port):
    return f"http://127.0.0.1:{port}"


def wait_for_url(url, timeout_seconds=30):
    deadline = time.monotonic() + timeout_seconds

    while time.monotonic() < deadline:
        try:
            with urlopen(Request(url, headers={"User-Agent": "uyc-dev"}), timeout=2) as response:
                if 200 <= response.status < 500:
                    return True
        except (HTTPError, URLError, TimeoutError, OSError):
            time.sleep(0.5)

    return False


def start_worker(name, config):
    port = config["port"]
    command = [
        "npx",
        "wrangler",
        "dev",
        "--local",
        "--port",
        str(port),
        "--show-interactive-dev-session=false",
    ]

    for value in config["vars"]:
        command.extend(["--var", value])

    print(f"Starting {config['label']} on {worker_url(port)}")
    print(f"  Local JSON: {worker_url(port)}{config['object_path']}")
    print("  Requests generate JSON directly without writing R2 or purging caches")

    process = subprocess.Popen(command, cwd=config["cwd"])

    if not wait_for_url(worker_url(port)):
        print(f"{config['label']} did not become ready within 30s; continuing anyway.")

    return process


def start_site(args, selected_workers):
    command = [
        sys.executable,
        str(ROOT / "dev" / "local_server.py"),
        "--port",
        str(args.site_port),
        "--root",
        str(ROOT / "site"),
    ]

    if args.no_open:
        command.append("--no-open")

    if "weather" in selected_workers:
        command.extend(["--weather-worker-url", worker_url(WORKERS["weather"]["port"])])

    if "events" in selected_workers:
        command.extend(["--events-worker-url", worker_url(WORKERS["events"]["port"])])

    print(f"Starting local site on http://127.0.0.1:{args.site_port}/")
    return subprocess.Popen(command, cwd=ROOT)


def print_intro(args, selected_workers):
    print("UYC local development")
    print("=====================")
    print(f"Site: http://127.0.0.1:{args.site_port}/")

    if selected_workers:
        print("Local workers enabled:")
        for name in selected_workers:
            config = WORKERS[name]
            print(f"  {name}: {worker_url(config['port'])}{config['object_path']}")
        print("The site server will proxy JSON requests to local workers and fall back to https://test.uyc.boats.")
    else:
        print("No local workers enabled; /var/* will proxy to https://test.uyc.boats.")

    print("Use Ctrl+C to stop everything.")
    print()


def parse_args():
    parser = argparse.ArgumentParser(description="Run the UYC local dev site and optional workers")
    parser.add_argument("--site-port", type=int, default=8080, help="Local web server port")
    parser.add_argument("--weather-worker", action="store_true", help="Start the local weather worker")
    parser.add_argument("--events-worker", action="store_true", help="Start the local events worker")
    parser.add_argument("--workers", action="store_true", help="Start both local workers")
    parser.add_argument("--no-open", action="store_true", help="Do not open a browser")
    return parser.parse_args()


def main():
    args = parse_args()
    selected_workers = []

    if args.workers or args.weather_worker:
        selected_workers.append("weather")

    if args.workers or args.events_worker:
        selected_workers.append("events")

    print_intro(args, selected_workers)

    processes = []

    try:
        for name in selected_workers:
            processes.append(start_worker(name, WORKERS[name]))

        site_process = start_site(args, selected_workers)
        processes.append(site_process)
        site_process.wait()
    except KeyboardInterrupt:
        print("\nStopping local development processes")
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()

        for process in reversed(processes):
            if process.poll() is None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()


if __name__ == "__main__":
    main()
