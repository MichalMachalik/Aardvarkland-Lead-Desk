"""Structured classification over a closed catalogue of fictional messages."""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = {item["id"]: item for item in json.loads((ROOT / "docs/assets/scenarios.json").read_text("utf-8"))}
SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": ["crm", "booking", "unknown"]},
        "weekly": {"type": ["integer", "null"]},
        "deadline": {"type": "string", "enum": ["this_month", "next_month", "unknown"]},
    },
    "required": ["intent", "weekly", "deadline"], "additionalProperties": False,
}
PROMPT = ("Classify the Czech enquiry using only its text. intent: crm for lead entry, booking for bookings, "
          "unknown if the process is not given. weekly: numeric count per week, null if absent. "
          "deadline: this_month, next_month, unknown. Do not infer missing information. Return only JSON.")

def classify(scenario):
    return classify_message(SCENARIOS[scenario]["text"])

def classify_message(message):
    body = {"messages": [{"role": "system", "content": PROMPT}, {"role": "user", "content": message}],
            "temperature": 0, "seed": 42, "max_tokens": 90,
            "response_format": {"type": "json_schema", "json_schema": {"name": "qualification", "schema": SCHEMA}}}
    request = urllib.request.Request("http://127.0.0.1:17964/v1/chat/completions",
                                     json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=85) as response:
        value = json.load(response)
    answer = json.loads(value["choices"][0]["message"]["content"])
    if set(answer) != set(SCHEMA["required"]):
        raise ValueError("Incomplete classification")
    return answer

if __name__ == "__main__":
    from datetime import datetime, timezone
    records = {key: classify(key) for key in SCENARIOS}
    expected = {"crm": ("crm", 40, "this_month"), "price": ("unknown", None, "unknown"),
                "booking": ("booking", 12, "next_month")}
    for key, record in records.items():
        if tuple(record[f] for f in SCHEMA["required"]) != expected[key]:
            raise ValueError(f"Unexpected recorded result for {key}: {record}")
    evidence = {"model": "Qwen3-4B-Instruct-2507-Q4_K_M", "recorded": datetime.now(timezone.utc).isoformat(),
                "temperature": 0, "results": records}
    (ROOT / "relay/recordings.json").write_text(json.dumps(evidence, indent=2) + "\n", "utf-8")
    print("Saved three verified model responses.")
