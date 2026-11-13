#!/usr/bin/env python3
"""Plan 218.1 Task 2: serve Prism's S through Compact-Bench's own `compress` seam.

Run with `python3 -I` (isolated: no user site, no script directory on sys.path). It imports only the pinned upstream
checkout given by --code, so upstream's code does the scoring and the task runs.

  retention  Score S records with upstream's `e2_score.compress_one` (its `summarize` call is replaced by a lookup of
             the record's S). Per record: recall, atom count and the per-atom hit vector (no text).
  task       Run upstream's `run.py` task track with the given arguments. Before upstream launches `e1_xb` for a
             `prism-*` model, the seam writes that model's S to the summary cache `e1_xb` reads first, so the POST
             continuation, the PRE control and the FAIL_TO_PASS tests stay upstream's. A missing S is refused, never
             summarized.
  self-check Assert the pinned upstream still has the seams this file relies on.
"""
import argparse
import importlib
import json
import os
import sys

# The exact upstream lines this seam depends on (pinned checkout 9dd9a3f5...). A different checkout fails self-check.
E1_XB_CACHE_LINE = 's_cache = os.path.join(WORK, "work", f"{iid}.S.{tag}.{variant}{C.S_SFX}.txt")'
E1_XB_TAG_LINE = 'tag = f"xb-{C.file_id(backbone)}"'
E2_RECALL_LINE = 'hits = sum(1 for a in atoms if a["value"] in S)'
RUN_LAUNCH_LINE = 'def launch(module, *args, round_number=None):'
PRISM_PREFIX = "prism-"


def use_upstream(code):
    code = os.path.abspath(code)
    sys.path.insert(0, os.path.join(code, "harness"))
    sys.path.insert(0, code)
    os.chdir(code)
    return code


def self_check(code):
    checks = {
        "harness/e1_xb.py": [E1_XB_CACHE_LINE, E1_XB_TAG_LINE],
        "harness/e2_score.py": [E2_RECALL_LINE],
        "run.py": [RUN_LAUNCH_LINE],
    }
    missing = []
    for path, lines in checks.items():
        with open(os.path.join(code, path), encoding="utf-8") as source:
            text = source.read()
        missing += [f"{path}: {line}" for line in lines if line not in text]
    if missing:
        raise SystemExit("seam self-check failed:\n" + "\n".join(missing))
    return {"ok": True, "checked": sum(len(lines) for lines in checks.values())}


def retention(args):
    import cb_common as C
    import e2_score
    from cb_data import ensure_data

    with open(args.summaries, encoding="utf-8") as source:
        records = [json.loads(line) for line in source if line.strip()]
    wanted = {record["sample_id"] for record in records}
    sessions = {}
    with open(ensure_data("e2/sessions.jsonl"), encoding="utf-8") as source:
        for line in source:
            if not line.strip():
                continue
            sample = json.loads(line)
            if sample["sample_id"] in wanted:
                sessions[sample["sample_id"]] = sample
    unknown = wanted - set(sessions)
    if unknown:
        raise SystemExit(f"unknown sample ids: {sorted(unknown)[:5]}")

    current = {}
    C.summarize = lambda model, text, key, max_tokens=None: current["S"]
    C.key_for_model = lambda model: "unused"
    out = []
    for record in records:
        sample = sessions[record["sample_id"]]
        current["S"] = record["S"]
        transcript = C.transcript(sample["H"])
        scored = e2_score.compress_one(
            (sample["sample_id"], sample["client"], transcript, sample["atoms"], "claude", PRISM_PREFIX + record["arm"]))
        if "error" in scored:
            raise SystemExit(f"upstream scoring failed for {record['sample_id']}: {scored['error']}")
        hits = [1 if atom["value"] in record["S"] else 0 for atom in sample["atoms"]]
        if scored["recall"] is not None and abs(sum(hits) / len(hits) - scored["recall"]) > 1e-12:
            raise SystemExit("hit vector disagrees with upstream recall")
        out.append({"sample_id": sample["sample_id"], "client": sample["client"], "arm": record["arm"],
                    "view": record.get("view", "context"), "recall": scored["recall"], "n_atoms": scored["n_atoms"],
                    "S_len": scored["S_len"], "hits": hits})
    with open(args.out, "w", encoding="utf-8") as target:
        json.dump(out, target)
    print(json.dumps({"scored": len(out)}))


def s_cache_path(work_root, iid, model, variant, round_number):
    """The path `e1_xb` reads S from (E1_XB_CACHE_LINE), computed with upstream's own `file_id`."""
    import cb_common as C
    suffix = f".r{round_number}" if round_number and round_number > 1 else ""
    return os.path.join(work_root, "work", f"{iid}.S.xb-{C.file_id(model)}.{variant}{suffix}.txt")


def task(args, rest):
    if "--rounds" not in rest or rest[rest.index("--rounds") + 1] != "1":
        raise SystemExit("the seam serves one S per instance: pass --rounds 1")
    run = importlib.import_module("run")
    original = run.launch

    def launch(module, *launch_args, round_number=None):
        if module == "harness.e1_xb" and str(launch_args[1]).startswith(PRISM_PREFIX):
            iid, model, variant = (str(value) for value in launch_args[:3])
            source = os.path.join(args.s_dir, f"{iid}.{model}.txt")
            if not os.path.isfile(source):
                raise RuntimeError(f"no Prism S for {iid} {model}; refusing to summarize")
            target = s_cache_path(os.environ["CB_WORK_ROOT"], iid, model, variant, round_number)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(source, encoding="utf-8") as reader, open(target, "w", encoding="utf-8") as writer:
                writer.write(reader.read())
        return original(module, *launch_args, round_number=round_number)

    run.launch = launch
    sys.exit(run.main(rest))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("retention", "task", "self-check"))
    parser.add_argument("--code", required=True)
    parser.add_argument("--summaries")
    parser.add_argument("--out")
    parser.add_argument("--s-dir")
    args, rest = parser.parse_known_args()
    if rest and rest[0] == "--":
        rest = rest[1:]
    code = use_upstream(args.code)
    print(json.dumps(self_check(code)) if args.command == "self-check" else "", end="")
    if args.command == "retention":
        self_check(code)
        retention(args)
    elif args.command == "task":
        self_check(code)
        task(args, rest)


if __name__ == "__main__":
    main()
