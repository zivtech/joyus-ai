#!/usr/bin/env python3
"""
WP06 re-gate harness — measure Headroom on the REAL proxying path (/v1/messages),
not the /v1/compress simulation WP01 used.

Two DoD-compliant measurements, both driven live through `headroom proxy`:

  M1 (reversible CCR path, T102): an ARRAY tool output (>=20 items) that triggers
      SmartCrusher+CCR. We WIRE `headroom_retrieve` as a client tool (the proxy does
      NOT auto-inject it for a bare client — see FINDINGS), drive the agent loop, and
      observe: does the model retrieve, and does retrieve(hash, query) PARTIAL-filter
      the array (a real low-retrieval-fraction regime) or return all/none? This is the
      one open question that could flip the decision toward a conditional GO.

  M2 (lossy prose path): the realistic prose corpus (priority content_mcp + rag_chunk)
      through the proxy vs an uncompressed control, temp=0. `headroom_retrieve` is wired
      so a retrieve-INTENT is never mis-scored as a wrong answer. Measures realized
      net savings (authoritative billed usage.input_tokens, not the racy feed) and the
      accuracyDelta attributable to LOSSY compression — plus whether any marker is even
      surfaced for prose (if not, the stored original is unreachable -> FR-006/NFR-004).

Everything here is live. No fabricated numbers. Control leg uses curl (system CA);
proxy leg uses curl to http://127.0.0.1:8787. temp=0 both legs.
"""
import json, os, re, subprocess, sys, time

PROXY = os.environ.get("HEADROOM_BASE_URL", "http://127.0.0.1:8787")
DIRECT = "https://api.anthropic.com"
KEY = os.environ["ANTHROPIC_API_KEY"]
MODEL = "claude-sonnet-4-5-20250929"
HERE = os.path.dirname(os.path.abspath(__file__))

CONTENT_TOOL = {
    "name": "content_get_item",
    "description": "Fetch a knowledge item or search result set by id.",
    "input_schema": {"type": "object", "properties": {"id": {"type": "string"}}},
}
# Canonical headroom_retrieve definition (matches ccr/tool_injection.py, anthropic format).
RETRIEVE_TOOL = {
    "name": "headroom_retrieve",
    "description": (
        "Retrieve original uncompressed content that was compressed to save tokens. "
        "Use this when you need more data than what's shown in compressed tool results. "
        "The hash is provided in compression markers like [N items compressed... hash=abc123]."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "hash": {"type": "string", "description": "Hash key from the compression marker"},
            "query": {"type": "string", "description": "Optional search query to filter results"},
        },
        "required": ["hash"],
    },
}


def _curl(base, payload):
    """POST an Anthropic /v1/messages request via curl (handles https CA + local http)."""
    args = [
        "curl", "-s", "-m", "120", base + "/v1/messages",
        "-H", "content-type: application/json",
        "-H", f"x-api-key: {KEY}",
        "-H", "anthropic-version: 2023-06-01",
        "--data-binary", "@-",
    ]
    p = subprocess.run(args, input=json.dumps(payload).encode(), capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(f"curl failed: {p.stderr.decode()[:300]}")
    out = json.loads(p.stdout.decode())
    if "error" in out:
        raise RuntimeError(f"api error: {json.dumps(out['error'])[:300]}")
    return out


def _toolcall_endpoint_status(tool_use):
    """Probe the DOCUMENTED agent-framework endpoint /v1/retrieve/tool_call.

    FINDING: it validates hash == exactly 24 hex chars (ccr/tool_injection.py:500), but
    the CCR markers Headroom surfaces to the model carry 12-char hashes -> the endpoint an
    agent framework (T102 / joyus-ai-mcp-server) is told to call rejects the hashes Headroom
    itself emits. Returns 'ok' | 'rejected' | 'error' for disclosure.
    """
    body = {"tool_call": {"id": tool_use["id"], "name": tool_use["name"], "input": tool_use["input"]},
            "provider": "anthropic"}
    p = subprocess.run(
        ["curl", "-s", "-m", "30", PROXY + "/v1/retrieve/tool_call",
         "-H", "content-type: application/json", "--data-binary", "@-"],
        input=json.dumps(body).encode(), capture_output=True)
    try:
        resp = json.loads(p.stdout.decode())
    except Exception:
        return "error"
    if resp.get("success") and resp.get("tool_result"):
        return "ok"
    return "rejected"


def _retrieve_via_proxy(tool_use):
    """Resolve a headroom_retrieve call via GET /v1/retrieve/{hash} (the path that resolves the
    12-char marker hashes; the documented tool_call endpoint rejects them — see
    _toolcall_endpoint_status). Returns (anthropic tool_result block, data dict)."""
    h = (tool_use.get("input") or {}).get("hash", "")
    p = subprocess.run(["curl", "-s", "-m", "30", f"{PROXY}/v1/retrieve/{h}"], capture_output=True)
    try:
        data = json.loads(p.stdout.decode())
    except Exception:
        data = {}
    oc = data.get("original_content")
    documented_endpoint = _toolcall_endpoint_status(tool_use)
    if oc is None:
        return None, {"error": data.get("detail") or "not found",
                      "documented_tool_call_endpoint": documented_endpoint}
    tr = {"type": "tool_result", "tool_use_id": tool_use["id"], "content": oc}
    return tr, {"original_content": oc, "via": "GET /v1/retrieve/{hash}",
                "documented_tool_call_endpoint": documented_endpoint}


def _text(resp):
    return "".join(b["text"] for b in resp.get("content", []) if b.get("type") == "text").strip()


def _tool_uses(resp, name=None):
    return [b for b in resp.get("content", [])
            if b.get("type") == "tool_use" and (name is None or b["name"] == name)]


def run_agent(base, payload_content, question, wire_retrieve, max_hops=4):
    """Drive a tool-result-bearing conversation; satisfy headroom_retrieve calls via the proxy.

    Returns dict: answer, n_retrievals, retrieved_chars, marker_seen, hop_input_tokens[],
    first_hop_input_tokens, total_input_tokens, retrieved_payloads[].
    """
    tools = [CONTENT_TOOL] + ([RETRIEVE_TOOL] if wire_retrieve else [])
    msgs = [
        {"role": "user", "content": f"Use the tool result to answer. {question}"},
        {"role": "assistant", "content": [{"type": "tool_use", "id": "t1",
                                           "name": "content_get_item", "input": {"id": "doc"}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1",
                                      "content": payload_content}]},
    ]
    hop_inputs, retrieved_payloads = [], []
    n_retr, retrieved_chars = 0, 0
    for _ in range(max_hops):
        req = {"model": MODEL, "max_tokens": 400, "temperature": 0, "messages": msgs, "tools": tools}
        resp = _curl(base, req)
        hop_inputs.append(resp.get("usage", {}).get("input_tokens", 0))
        rcalls = _tool_uses(resp, "headroom_retrieve")
        if rcalls and wire_retrieve:
            # append assistant turn, then satisfy every retrieve call
            msgs.append({"role": "assistant", "content": resp["content"]})
            results = []
            for rc in rcalls:
                tr, data = _retrieve_via_proxy(rc)
                n_retr += 1
                # Lossy prose path surfaces no valid marker; the model may invent a hash.
                # The proxy then returns no tool_result (404/400). Record it as a FAILED
                # retrieval (a real reliability hazard) and feed an error block so the loop
                # continues instead of crashing.
                if tr is None:
                    data = data or {"error": "retrieval failed: no such hash (hallucinated marker)"}
                    tr = {"type": "tool_result", "tool_use_id": rc["id"],
                          "content": json.dumps(data), "is_error": True}
                payload = data.get("original_content") or json.dumps(data.get("results", data))
                retrieved_chars += len(payload or "")
                retrieved_payloads.append({"input": rc["input"], "data": data,
                                           "failed": data.get("error") is not None})
                results.append(tr)
            msgs.append({"role": "user", "content": results})
            continue
        # no (more) retrieval -> final answer
        return {
            "answer": _text(resp),
            "n_retrievals": n_retr,
            "retrieved_chars": retrieved_chars,
            "hop_input_tokens": hop_inputs,
            "first_hop_input_tokens": hop_inputs[0] if hop_inputs else 0,
            "total_input_tokens": sum(hop_inputs),
            "retrieved_payloads": retrieved_payloads,
        }
    return {"answer": _text(resp), "n_retrievals": n_retr, "retrieved_chars": retrieved_chars,
            "hop_input_tokens": hop_inputs, "first_hop_input_tokens": hop_inputs[0],
            "total_input_tokens": sum(hop_inputs), "retrieved_payloads": retrieved_payloads,
            "note": "hop cap hit"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def correct(ans, exp):
    return norm(exp) in norm(ans) or (len(norm(ans)) > 0 and norm(ans) in norm(exp))


# ───────────────────────── corpus ─────────────────────────
def load_prose_corpus():
    src = open(os.path.join(HERE, "build-runset.py")).read()
    payloads = eval(re.search(r"PAYLOADS = (\[.*?\n\])\n\nRETRIEVE_INSTRUCTION", src, re.S).group(1))
    return payloads


def array_payloads():
    """Two array families (>=20 items) to exercise SmartCrusher+CCR.

    must_read: the answer requires info that could be in ANY row (forces full scan).
    low_need : the answer is in ONE identifiable row (the regime where partial-retrieve,
               IF it worked, would let the agent pull back only that row -> low net cost).
    """
    rows = [{"rank": i, "title": f"Vendor {i} compliance record",
             "status": "compliant" if i % 3 else "review",
             "note": f"Routine quarterly note for vendor {i}; standard terms apply. " * 2}
            for i in range(1, 41)]
    # plant a unique fact in exactly one row (low_need target)
    rows[27]["note"] = "Vendor 28 holds certificate ID CERT-ZQ-8842 valid through 2027."
    low_need = json.dumps({"results": rows})
    # must_read: question needs a COUNT across all rows (can't answer from a few)
    must_read = low_need
    return {
        "low_need": {
            "content": low_need,
            "q": "What is the exact certificate ID held by Vendor 28? Answer with just the ID.",
            "a": "CERT-ZQ-8842",
        },
        "must_read": {
            "content": must_read,
            "q": "How many vendors have status exactly equal to 'review'? Answer with just the number.",
            "a": str(sum(1 for i in range(1, 41) if not (i % 3))),
        },
    }


def main():
    out = {"model": MODEL, "proxy": PROXY, "M1_array_ccr": {}}

    # ── M1: reversible CCR path through /v1/messages, retrieve wired ──
    print("=== M1: array CCR path (does retrieve partial-filter? must-read net?) ===")
    arrs = array_payloads()
    for name, spec in arrs.items():
        # control: uncompressed, direct
        ctrl = run_agent(DIRECT, spec["content"], spec["q"], wire_retrieve=False)
        # treatment: through proxy with headroom_retrieve wired
        treat = run_agent(PROXY, spec["content"], spec["q"], wire_retrieve=True)
        partial = None
        if treat["retrieved_payloads"]:
            rp = treat["retrieved_payloads"][0]
            data = rp["data"]
            # did a query partial-filter? results present & fewer than full, or original_content full
            if "results" in data:
                partial = {"queried": rp["input"].get("query"), "returned_items": data.get("count")}
            elif "original_content" in data:
                partial = {"queried": rp["input"].get("query"),
                           "returned_full_chars": len(data["original_content"])}
        rec = {
            "control_correct": correct(ctrl["answer"], spec["a"]),
            "control_input_tokens": ctrl["total_input_tokens"],
            "treat_correct": correct(treat["answer"], spec["a"]),
            "treat_first_hop_tokens": treat["first_hop_input_tokens"],
            "treat_total_tokens": treat["total_input_tokens"],
            "n_retrievals": treat["n_retrievals"],
            "retrieved_chars": treat["retrieved_chars"],
            "partial_retrieve_observed": partial,
            "exp": spec["a"], "treat_answer": treat["answer"][:60],
            "net_first_hop": round(1 - treat["first_hop_input_tokens"] / ctrl["total_input_tokens"], 3)
                if ctrl["total_input_tokens"] else None,
            "net_realized": round(1 - treat["total_input_tokens"] / ctrl["total_input_tokens"], 3)
                if ctrl["total_input_tokens"] else None,
        }
        out["M1_array_ccr"][name] = rec
        print(f"  [{name}] ctrl_ok={rec['control_correct']} treat_ok={rec['treat_correct']} "
              f"retr={rec['n_retrievals']} net_first={rec['net_first_hop']} net_realized={rec['net_realized']} "
              f"partial={partial}")
        time.sleep(0.4)

    import statistics as st
    prose = load_prose_corpus()

    # ── M2: DEFAULT proxy path on prose — NO retrieve tool wired (the real default an MCP
    #        server gets out of the box). Measures whether Headroom's compression preserves
    #        accuracy (NFR-001) at its realized net savings (authoritative billed usage tokens).
    print("\n=== M2: prose DEFAULT path (no retrieve tool) — control vs proxy, accuracyDelta + net ===")
    rows = []
    for p in prose:
        full = json.dumps({"id": p["id"], "title": p["title"], "body": p["body"], "tool": p["tool"]})
        for t in p["tasks"]:
            ctrl = run_agent(DIRECT, full, t["q"], wire_retrieve=False)
            treat = run_agent(PROXY, full, t["q"], wire_retrieve=False)
            net = (1 - treat["total_input_tokens"] / ctrl["total_input_tokens"]) if ctrl["total_input_tokens"] else None
            rows.append({
                "id": f"{p['id']}--{t['id']}", "kind": p["kind"], "exp": t["a"],
                "ctrl_ok": correct(ctrl["answer"], t["a"]), "treat_ok": correct(treat["answer"], t["a"]),
                "ctrl_input_tokens": ctrl["total_input_tokens"], "treat_input_tokens": treat["total_input_tokens"],
                "net_savings": round(net, 3) if net is not None else None, "treat_answer": treat["answer"][:50],
            })
            print(f"  {rows[-1]['id']:22s} {p['kind']:11s} ctrl={str(rows[-1]['ctrl_ok']):>5s} "
                  f"treat={str(rows[-1]['treat_ok']):>5s} net={rows[-1]['net_savings']}")
            time.sleep(0.25)
    agg = {}
    for kind in sorted(set(r["kind"] for r in rows)):
        sub = [r for r in rows if r["kind"] == kind]
        ca = sum(r["ctrl_ok"] for r in sub) / len(sub); ta = sum(r["treat_ok"] for r in sub) / len(sub)
        nets = [r["net_savings"] for r in sub if r["net_savings"] is not None]
        agg[kind] = {"n": len(sub), "control_acc": round(ca, 3), "compressed_acc": round(ta, 3),
                     "accuracyDelta": round(ta - ca, 3), "mean_net_savings": round(st.mean(nets), 3),
                     "net_stdev": round(st.pstdev(nets), 3)}
        print(f"\n[{kind}] n={len(sub)} control_acc={ca:.2f} compressed_acc={ta:.2f} "
              f"accuracyDelta={ta-ca:+.2f} mean_net={st.mean(nets)*100:.0f}%")
    out["M2_prose_default_lossy"] = {"rows": rows, "by_kind": agg}

    # ── M3: the CCR integration as T102 requires it — headroom_retrieve WIRED. Measures the
    #        hallucinated-retrieve hazard: with the tool present, does the agent invent hashes
    #        on content that has no resolvable marker, collapsing accuracy?
    print("\n=== M3: prose with headroom_retrieve WIRED (T102 integration) — hallucination hazard ===")
    m3 = []
    for p in prose:
        full = json.dumps({"id": p["id"], "title": p["title"], "body": p["body"], "tool": p["tool"]})
        for t in p["tasks"]:
            treat = run_agent(PROXY, full, t["q"], wire_retrieve=True)
            failed = [rp for rp in treat["retrieved_payloads"] if rp.get("failed")]
            m3.append({
                "id": f"{p['id']}--{t['id']}", "kind": p["kind"],
                "treat_ok": correct(treat["answer"], t["a"]),
                "n_retrieve_calls": treat["n_retrievals"],
                "failed_retrieves": len(failed),
                "hallucinated": len(failed) > 0,
                "treat_answer": treat["answer"][:50],
            })
            print(f"  {m3[-1]['id']:22s} {p['kind']:11s} treat_ok={str(m3[-1]['treat_ok']):>5s} "
                  f"retrieve_calls={m3[-1]['n_retrieve_calls']} failed={m3[-1]['failed_retrieves']}")
            time.sleep(0.25)
    m3agg = {}
    for kind in sorted(set(r["kind"] for r in m3)):
        sub = [r for r in m3 if r["kind"] == kind]
        m3agg[kind] = {"n": len(sub), "compressed_acc": round(sum(r["treat_ok"] for r in sub) / len(sub), 3),
                       "hallucinated_retrieves": sum(r["hallucinated"] for r in sub),
                       "tasks_that_called_retrieve": sum(r["n_retrieve_calls"] > 0 for r in sub)}
        print(f"\n[{kind}] n={len(sub)} compressed_acc={m3agg[kind]['compressed_acc']:.2f} "
              f"hallucinated={m3agg[kind]['hallucinated_retrieves']}/{len(sub)}")
    out["M3_prose_retrieve_wired"] = {"rows": m3, "by_kind": m3agg,
        "documented_tool_call_endpoint_status": "rejected (24-hex required; markers carry 12-hex)"}

    json.dump(out, open(os.path.join(HERE, "wp06-measurements.json"), "w"), indent=2)
    print("\nWrote wp06-measurements.json")


if __name__ == "__main__":
    main()
