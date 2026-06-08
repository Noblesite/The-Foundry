#!/usr/bin/env python3
"""Check the local Foundry API without requiring optional model packages."""

from __future__ import annotations

import json
import sys
from urllib.error import URLError
from urllib.request import urlopen


BASE_URL = "http://127.0.0.1:8000"
ENDPOINTS = (
    "/api/v1/foundry/bootstrap",
    "/api/v1/constructs/runtime",
)


def main() -> int:
    for endpoint in ENDPOINTS:
        url = f"{BASE_URL}{endpoint}"
        try:
            with urlopen(url, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except URLError as error:
            print(f"FAIL: {url} is not reachable: {error}")
            return 1
        except json.JSONDecodeError:
            print(f"FAIL: {url} did not return JSON.")
            return 1

        if "data" not in payload:
            print(f"FAIL: {url} returned an unexpected envelope.")
            return 1

        print(f"OK: {url}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
