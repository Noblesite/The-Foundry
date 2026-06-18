#!/usr/bin/env python3
"""Run the public MVP flow against a live Foundry API server.

This is a tiny, repeatable dress rehearsal for the baseline install lane. It
does not download models or require optional ML packages; the goal is to prove
the live API handoffs from Material to saved Trial.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE_URL = os.getenv("FOUNDRY_API_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


class ApiError(RuntimeError):
    pass


def request_json(
    method: str,
    path: str,
    *,
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | bytes | None = None,
    expected_status: int = 200,
) -> dict[str, Any]:
    url = f"{BASE_URL}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"

    headers: dict[str, str] = {}
    payload: bytes | None = None
    if isinstance(body, dict):
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif isinstance(body, bytes):
        payload = body

    request = Request(url, data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            response_body = response.read().decode("utf-8")
            status = response.status
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ApiError(f"{method} {url} failed with HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise ApiError(f"{method} {url} is not reachable: {error}") from error

    if status != expected_status:
        raise ApiError(f"{method} {url} returned HTTP {status}, expected {expected_status}.")

    try:
        envelope = json.loads(response_body)
    except json.JSONDecodeError as error:
        raise ApiError(f"{method} {url} did not return JSON.") from error

    if "data" not in envelope:
        raise ApiError(f"{method} {url} returned an unexpected response envelope.")

    return envelope["data"]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ApiError(message)


def main() -> int:
    suffix = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    report: dict[str, Any] = {
        "baseUrl": BASE_URL,
        "mode": "simulated-runtime-proof",
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }

    status = request_json("GET", "/api/v1/foundry/status")
    report["status"] = status.get("status", "unknown")

    runtime = request_json(
        "POST",
        "/api/v1/assembly-line/qa-generator/runtime/configure",
        body={
            "mode": "deterministic",
            "modelId": "sshleifer/tiny-gpt2",
            "maxNewTokens": 128,
            "temperature": 0.1,
        },
    )
    require(runtime["ready"] is True, "QA generator did not enter a ready state.")

    workshop = request_json(
        "POST",
        "/api/v1/workshops",
        body={
            "name": f"MVP Manual Rehearsal {suffix}",
            "subject": "Foundry MVP",
            "voiceTarget": "Engineer",
            "baseModel": "sshleifer/tiny-gpt2",
        },
    )
    report["workshopId"] = workshop["id"]

    material = request_json(
        "POST",
        f"/api/v1/workshops/{workshop['id']}/materials/import-file",
        query={
            "name": f"MVP Notes {suffix}",
            "kind": "text",
            "filename": "mvp-notes.txt",
        },
        body=(
            b"Marshall helps the team during rescues. "
            b"Rubble brings tools when repairs are needed. "
            b"The Foundry turns source material into teachable QA pairs."
        ),
    )
    require(material["status"] == "staged", "Material import did not reach staged status.")
    report["materialId"] = material["id"]

    assembly = request_json(
        "POST",
        f"/api/v1/workshops/{workshop['id']}/assembly-lines",
        body={
            "materialSourceIds": [material["id"]],
            "chunkSizeTokens": 128,
            "chunkOverlapTokens": 0,
            "qaPairsPerSource": 1,
        },
    )
    report["assemblyLineRunId"] = assembly["id"]

    qa_pairs = request_json(
        "GET",
        f"/api/v1/workshops/{workshop['id']}/qa-pairs",
        query={"runId": assembly["id"]},
    )
    require(bool(qa_pairs), "Assembly Line did not create QA pairs.")
    first_pair = qa_pairs[0]

    accepted = request_json(
        "PATCH",
        f"/api/v1/workshops/{workshop['id']}/qa-pairs/{first_pair['id']}",
        body={
            "question": f"{first_pair['question']} Reviewed?",
            "answer": f"{first_pair['answer']} Reviewed.",
            "reviewStatus": "accepted",
        },
    )
    require(accepted["reviewStatus"] == "accepted", "QA pair did not save as accepted.")
    report["qaPairId"] = accepted["id"]

    exported = request_json(
        "POST",
        f"/api/v1/workshops/{workshop['id']}/qa-pairs/export",
        body={
            "assemblyLineRunId": assembly["id"],
            "name": f"MVP Accepted Rows {suffix}",
            "includeLowQuality": True,
        },
    )
    require(exported["format"] == "jsonl", "QA export did not create JSONL.")
    report["exportedMaterialId"] = exported["material"]["id"]
    report["qaExportQualityGate"] = exported["qualityGate"]["status"]

    forge = request_json(
        "POST",
        f"/api/v1/workshops/{workshop['id']}/forges",
        body={
            "materialSetId": exported["material"]["id"],
            "baseModel": "sshleifer/tiny-gpt2",
            "method": "LoRA",
            "purpose": "training",
            "epochs": 1,
            "learningRate": "0.0002",
            "loadIn4Bit": False,
        },
    )
    require(forge["trainingContract"]["contractVersion"] == "foundry.forge.training.v1", "Forge contract version mismatch.")
    report["forgeRunId"] = forge["id"]

    preflight = request_json("POST", f"/api/v1/forges/{forge['id']}/worker/preflight-local")
    report["localForgePreflightOk"] = preflight["ok"]

    completed_forge = forge
    for _ in range(12):
        completed_forge = request_json("POST", f"/api/v1/forges/{forge['id']}/simulate")
        if completed_forge["status"] == "completed":
            break
    require(completed_forge["status"] == "completed", "Forge simulator did not complete within 12 ticks.")
    require(completed_forge["artifactId"], "Completed Forge did not create an Artifact.")
    report["artifactId"] = completed_forge["artifactId"]

    artifacts = request_json("GET", f"/api/v1/workshops/{workshop['id']}/artifacts")
    artifact = next((item for item in artifacts if item["id"] == completed_forge["artifactId"]), None)
    require(artifact is not None, "Created Artifact was not listed for the Workshop.")
    require(artifact["readiness"]["canLoad"] is True, "Artifact readiness did not allow Construct load.")

    construct = request_json(
        "POST",
        f"/api/v1/workshops/{workshop['id']}/constructs/load-artifact",
        body={"artifactId": artifact["id"]},
    )
    require(construct["artifactId"] == artifact["id"], "Construct was not loaded from the created Artifact.")
    report["constructId"] = construct["id"]

    prompt = "What should a new engineer learn from this Forge?"
    chat = request_json(
        "POST",
        f"/api/v1/constructs/{construct['id']}/chat",
        body={
            "conversationId": f"mvp-manual-rehearsal-{suffix}",
            "message": prompt,
            "includeLibraryContext": False,
            "maxNewTokens": 64,
            "temperature": 0.2,
        },
    )
    require(chat["artifact"]["id"] == artifact["id"], "Construct reply did not reference the loaded Artifact.")
    require(chat["message"]["text"], "Construct reply was empty.")
    report["messageId"] = chat["message"]["id"]

    trial = request_json(
        "POST",
        f"/api/v1/workshops/{workshop['id']}/trials",
        body={
            "artifactId": artifact["id"],
            "constructId": construct["id"],
            "messageId": chat["message"]["id"],
            "prompt": prompt,
            "response": chat["message"]["text"],
            "verdict": "pass",
            "runtimeMode": "simulated",
            "tokenCount": chat["message"]["tokenCount"],
            "generationSettings": chat["generation"],
        },
    )
    require(trial["verdict"] == "pass", "Trial verdict did not save.")
    report["trialId"] = trial["id"]

    trials = request_json("GET", f"/api/v1/workshops/{workshop['id']}/trials")
    require(any(item["id"] == trial["id"] for item in trials), "Saved Trial was not listed.")
    report["completedAt"] = datetime.now(timezone.utc).isoformat()

    print("PASS: live Foundry MVP rehearsal completed.")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApiError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
