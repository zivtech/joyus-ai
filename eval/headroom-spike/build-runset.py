#!/usr/bin/env python3
"""
WP01 accuracy-A/B builder (retargeted: large-prose content via CCR).

For each large-prose payload:
  1. write it to corpus/<kind>/ (real synthetic corpus, C-006 safe),
  2. compress via the local proxy /v1/compress (body -> <<ccr:HASH>> marker),
  3. verify GET /v1/retrieve/{HASH} returns the original byte-identical,
  4. emit runset/<task>-control.txt  (FULL payload + question)
     and runset/<task>-treatment.txt (COMPRESSED payload + question + retrieve affordance),
  5. record per-payload savings + reversibility in runset/measurements.json,
  6. keep expected answers in runset/_expected.json (subagents never read this).

Tasks are fact-extraction questions whose answers live ONLY in the prose body, so a
treatment agent that does NOT retrieve the dropped body cannot answer them. Answers are
short and exact-match scorable (no LLM judge).
"""
import json, re, urllib.request, os, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
PROXY = "http://127.0.0.1:8787"

def compress(content: str):
    body = json.dumps({"model": "claude-sonnet-4-5-20250929",
                       "messages": [{"role": "tool", "tool_call_id": "c1", "content": content}]}).encode()
    req = urllib.request.Request(PROXY + "/v1/compress", data=body,
                                 headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=60))
    out = ""
    for m in r["messages"]:
        if m.get("role") == "tool":
            out = m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])
    return r, out

def retrieve(h: str) -> str:
    rr = urllib.request.urlopen(f"{PROXY}/v1/retrieve/{h}", timeout=30)
    return json.load(rr).get("original_content", "")

# ── Payloads: each body carries 2 planted facts; each fact -> one question ──────────
# All synthetic / generic (C-006). Bodies are >=400 chars so CCR engages.
PAYLOADS = [
    {
        "id": "cm-getitem-001", "kind": "content_mcp", "tool": "content_get_item",
        "title": "Returns and refunds procedure",
        "body": ("The returns process begins when a customer initiates an RMA through the support portal. "
                 "An agent inspects the item against the condition grade and routes it to restock, refurbish, or dispose. "
                 "Approved refunds are processed to the original payment method within 7 business days. "
                 "Restocking fees of 15 percent apply to opened electronics but never to defective goods. "
                 "Items must be returned within 30 days of delivery; after that window only store credit is offered. "
                 "Shipping costs are refunded only when the return results from a fulfillment error on our side."),
        "tasks": [
            {"id": "t1", "q": "Within how many business days are approved refunds processed to the original payment method? Answer with just the number.", "a": "7"},
            {"id": "t2", "q": "What restocking fee percentage applies to opened electronics? Answer with just the number.", "a": "15"},
        ],
    },
    {
        "id": "cm-getitem-002", "kind": "content_mcp", "tool": "content_get_item",
        "title": "Incident response runbook",
        "body": ("On detecting a sev-1 outage the on-call engineer is paged and a war-room channel is opened. "
                 "A public status update must be posted within 15 minutes of confirmation. "
                 "An incident commander is assigned and owns the timeline of events. "
                 "A blameless postmortem is scheduled within 48 hours of resolution and circulated to all engineering leads. "
                 "Sev-2 incidents follow the same flow but allow a 60 minute status cadence. "
                 "The escalation contact for payment-system outages is the platform reliability team, not the application team."),
        "tasks": [
            {"id": "t1", "q": "Within how many minutes of confirmation must a public status update be posted for a sev-1 outage? Answer with just the number.", "a": "15"},
            {"id": "t2", "q": "Within how many hours of resolution must a blameless postmortem be scheduled? Answer with just the number.", "a": "48"},
        ],
    },
    {
        "id": "cm-getitem-003", "kind": "content_mcp", "tool": "content_get_item",
        "title": "Vendor onboarding standard",
        "body": ("Before a vendor is activated, finance confirms tax documentation, banking details for ACH disbursement, "
                 "a signed master services agreement, and a certificate of insurance. "
                 "Initial payment terms are set to net-45 pending a first-quarter performance review. "
                 "A category manager is assigned and records the vendor's primary contact in the procurement system. "
                 "Vendors handling regulated data must additionally pass a security questionnaire administered by the compliance department. "
                 "The minimum insurance coverage required for logistics vendors is two million dollars in general liability."),
        "tasks": [
            {"id": "t1", "q": "What are the initial payment terms set for a new vendor (e.g., net-30)? Answer with just the net term.", "a": "net-45"},
            {"id": "t2", "q": "What is the minimum general-liability insurance coverage required for logistics vendors, in dollars? Answer with the amount in words or figures.", "a": "two million dollars"},
        ],
    },
    {
        "id": "cm-generate-001", "kind": "content_mcp", "tool": "content_generate",
        "title": "Generated summary: seasonal staffing plan",
        "body": ("Peak season runs from mid-November through early January, during which temporary headcount scales to "
                 "140 percent of the baseline workforce. Permanent staff are cross-trained on packing stations and shift "
                 "starts are staggered in 30 minute increments to smooth the morning ramp. The plan caps mandatory overtime "
                 "at 10 hours per week and guarantees a minimum of two consecutive days off in every seven-day period. "
                 "Seasonal hires complete a four-hour safety orientation before their first shift on the floor."),
        "tasks": [
            {"id": "t1", "q": "To what percentage of the baseline workforce does temporary headcount scale during peak season? Answer with just the number.", "a": "140"},
            {"id": "t2", "q": "How many hours is the safety orientation that seasonal hires must complete before their first shift? Answer with just the number.", "a": "four"},
        ],
    },
    {
        "id": "rag-001", "kind": "rag_chunk", "tool": "content_search_chunk",
        "title": "Data retention standard (chunk)",
        "body": ("Operational application logs are retained for 90 days and then purged automatically. "
                 "Security and audit logs are retained for one year to support investigations. "
                 "Financial records are retained for seven years to satisfy regulatory requirements. "
                 "Personal data is deleted within 30 days of account closure unless a legal hold is in effect. "
                 "Backups are encrypted at rest and rotated on a 35 day cycle. "
                 "The data protection officer must approve any retention exception in writing."),
        "tasks": [
            {"id": "t1", "q": "For how many years are financial records retained? Answer with just the number.", "a": "seven"},
            {"id": "t2", "q": "On how many days is the backup rotation cycle? Answer with just the number.", "a": "35"},
        ],
    },
    {
        "id": "rag-002", "kind": "rag_chunk", "tool": "content_search_chunk",
        "title": "Accessibility conformance notes (chunk)",
        "body": ("All interactive controls must be reachable by keyboard and expose an accessible name. "
                 "Color is never the sole means of conveying state or meaning. "
                 "The project targets WCAG 2.1 level AA conformance across all public pages. "
                 "Focus-visible indicators must meet a contrast ratio of at least 3 to 1 against adjacent colors. "
                 "Time limits longer than 20 hours are exempt from the adjustable-timing requirement. "
                 "Automated checks run in CI but never replace a manual keyboard pass before release."),
        "tasks": [
            {"id": "t1", "q": "What WCAG level does the project target (A, AA, or AAA)? Answer with just the level.", "a": "AA"},
            {"id": "t2", "q": "What minimum contrast ratio must focus-visible indicators meet against adjacent colors? Answer like '3:1' or '3 to 1'.", "a": "3 to 1"},
        ],
    },
    {
        "id": "rag-003", "kind": "rag_chunk", "tool": "content_search_chunk",
        "title": "Payment reconciliation guide (chunk)",
        "body": ("Settlement batches are matched against the order ledger every business day before noon. "
                 "Any variance greater than one dollar is flagged for manual review by the finance operations team. "
                 "Chargebacks are logged against the originating order and the dispute clock starts on the notification date. "
                 "A representment must be filed within 20 days or the chargeback is conceded automatically. "
                 "Reconciliation reports are archived in the data warehouse under the finance schema. "
                 "Currency conversion uses the rate captured at the time of authorization, not settlement."),
        "tasks": [
            {"id": "t1", "q": "Variances greater than how many dollars are flagged for manual review? Answer with just the number.", "a": "one"},
            {"id": "t2", "q": "Within how many days must a representment be filed before a chargeback is conceded automatically? Answer with just the number.", "a": "20"},
        ],
    },
    {
        "id": "cm-getitem-004", "kind": "content_mcp", "tool": "content_get_item",
        "title": "Knowledge base style rules",
        "body": ("Each article opens with the direct answer, then the steps, then the caveats. "
                 "Procedures use numbered lists and comparisons use tables. "
                 "Related articles are linked only at the end, never mid-paragraph. "
                 "An article is considered stale and flagged for review after 180 days without an update. "
                 "The maximum recommended article length is 1200 words; longer topics are split into a series. "
                 "Every article names a single accountable owner in its metadata."),
        "tasks": [
            {"id": "t1", "q": "After how many days without an update is an article flagged as stale? Answer with just the number.", "a": "180"},
            {"id": "t2", "q": "What is the maximum recommended article length in words? Answer with just the number.", "a": "1200"},
        ],
    },
]

RETRIEVE_INSTRUCTION = (
    "The payload below has had large fields replaced with compression markers of the form "
    "`<<ccr:HASH,string,SIZE>>`. The original content is available on demand. If answering the "
    "question requires content that was replaced by a marker, you MUST recover it by running this "
    "exact shell command (it returns JSON with an `original_content` field):\n"
    "    curl -s http://127.0.0.1:8787/v1/retrieve/HASH\n"
    "Replace HASH with the hash from the marker. Then answer using the recovered content."
)

def build():
    runset = os.path.join(HERE, "runset")
    if os.path.exists(runset):
        shutil.rmtree(runset)
    os.makedirs(runset)
    # reset corpus dirs (replace toy templates)
    for kind in ("content_mcp", "rag_chunk", "executor_output"):
        d = os.path.join(HERE, "corpus", kind)
        os.makedirs(d, exist_ok=True)
        for f in os.listdir(d):
            if f.endswith(".json"):
                os.remove(os.path.join(d, f))

    expected = {}
    measurements = []
    tasks_index = []

    for p in PAYLOADS:
        obj = {"id": p["id"], "title": p["title"], "body": p["body"], "tool": p["tool"]}
        full = json.dumps(obj)
        # write to corpus
        with open(os.path.join(HERE, "corpus", p["kind"], f"{p['id']}.json"), "w") as f:
            json.dump({"id": p["id"], "kind": p["kind"], "synthetic": True, "content": full}, f, indent=2)

        r, comp = compress(full)
        reduction = 1 - r.get("compression_ratio", 1)
        hashes = re.findall(r"<<ccr:([A-Za-z0-9]+)", comp)
        reversible = None
        if hashes:
            got = retrieve(hashes[0])
            reversible = (got == p["body"])
        measurements.append({
            "id": p["id"], "kind": p["kind"], "tokens_before": r["tokens_before"],
            "tokens_after": r["tokens_after"], "reduction": round(reduction, 4),
            "ccr_marker": bool(hashes), "reversible_byte_identical": reversible,
        })

        for t in p["tasks"]:
            tid = f"{p['id']}--{t['id']}"
            expected[tid] = t["a"]
            tasks_index.append({"task_id": tid, "kind": p["kind"]})
            q = (f"Question: {t['q']}\n\n"
                 "Answer with ONLY the answer requested, nothing else. Use only the payload content.")
            with open(os.path.join(runset, f"{tid}--control.txt"), "w") as f:
                f.write(f"You are given a tool-output payload. {q}\n\n--- PAYLOAD ---\n{full}\n")
            with open(os.path.join(runset, f"{tid}--treatment.txt"), "w") as f:
                f.write(f"You are given a COMPRESSED tool-output payload.\n{RETRIEVE_INSTRUCTION}\n\n{q}\n\n--- COMPRESSED PAYLOAD ---\n{comp}\n")

    with open(os.path.join(runset, "_expected.json"), "w") as f:
        json.dump(expected, f, indent=2)
    with open(os.path.join(runset, "measurements.json"), "w") as f:
        json.dump(measurements, f, indent=2)
    with open(os.path.join(runset, "tasks_index.json"), "w") as f:
        json.dump(tasks_index, f, indent=2)

    print(f"payloads: {len(PAYLOADS)}  tasks/condition: {len(expected)}")
    print("savings + reversibility per payload:")
    for m in measurements:
        print(f"  {m['id']:18s} {m['kind']:13s} {m['reduction']*100:5.1f}%  "
              f"ccr={m['ccr_marker']} reversible={m['reversible_byte_identical']}")
    allrev = all(m["reversible_byte_identical"] for m in measurements if m["ccr_marker"])
    print(f"all CCR payloads byte-identical reversible: {allrev}")

if __name__ == "__main__":
    build()
