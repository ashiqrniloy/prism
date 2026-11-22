#!/usr/bin/env python3
"""Plan 218.1 Task 4: serve one LOCA-Bench task instance to a Prism agent.

Run with `python3 -I` from the pinned venv (isolated: no user site, no PYTHON* variables, no script directory on
sys.path). The seam imports only the pinned upstream checkout given by --code and runs upstream's own pieces unchanged:

- the environment class and its parameters from the task config (`dynamic_import_class`, which generates the instance's
  data, local databases and ground truth under the workspace);
- the MCP servers (`setup_mcp_servers` and `MCPTool`), the tool schemas the model sees (`get_tool_function`) and every
  tool's output text;
- the episode wrapper (`ToolEnvWrapperOpenAI.step_openai`), which runs the instance's evaluator when the agent calls
  `claim_done`, or when the agent answers without a tool call (LOCA's ReAct loop then passes the text to `env.step`).

Only the loop differs: each step comes from the Prism agent over this process's stdio (one JSON object per line). The
protocol carries the prompt and tool schemas out, tool calls in, tool output out, and at the end only the reward and
the evaluation status (never the evaluator's feedback text).

Server commands are pinned: upstream starts some servers with `npx <pkg>` / `uvx <pkg>` (which download at run time)
and others with `uv run` (which may sync a project). The seam rewrites each to the locked local install (`--venv`,
`--node-modules`), and refuses any command it does not know.

  self-check  Assert the pinned upstream still has the lines this file relies on.
  tools       Print the tool schemas and prompt size of one instance (no model, no evaluation).
  serve       Run one instance over stdio.
  react       `loca-react`: upstream's own ReAct loop on one instance (the calibration arm), counts and reward only.
"""
import argparse
import contextlib
import json
import os
import sys

# The exact upstream lines this seam depends on (pinned checkout 8b6fac49...). A different checkout fails self-check.
UPSTREAM_LINES = {
    "inference/run_react.py": [
        "def setup_mcp_servers(",
        "def dynamic_import_class(class_path: str):",
        "        env = ToolEnvWrapperOpenAI(env, tools=[tool], max_tool_uses=max_tool_uses)",
        "            obs, info, user_prompt, tools = env.reset()",
        "                next_obs, reward, terminated, truncated, info = env.step_openai(response, verbose=False)",
        "load_dotenv()",
        "def run_single_task(",
        "        mcp_config = setup_mcp_servers(mcp_configs, task_workspace, agent_workspace)",
        '            "accuracy": reward,  # Final reward as accuracy',
        '                    "trim": trim_events or [],',
    ],
    "gem/tools/tool_env_wrapper.py": [
        "class ToolEnvWrapperOpenAI(EnvWrapper):",
        '                                if "claim_done" in returned_tool_name:',
        "            observation, reward, terminated, truncated, info = self.env.step(action)",
    ],
    "gem/tools/mcp_server/config_loader.py": [
        'args = ["--directory", str(project_root), "run", "python", str(script_path)]',
        'return "npx", args',
        'return "uvx", args',
    ],
}
# `npx <package>` → the bin the locked node install provides; `uvx <package>` and `direct` executables → the venv.
NPX_BINS = {
    "@modelcontextprotocol/server-filesystem": "mcp-server-filesystem",
    "@modelcontextprotocol/server-memory": "mcp-server-memory",
}
VENV_EXECUTABLES = {"pdf-tools-mcp", "cli-mcp-server"}
# `excel-mcp-server` needs an `mcp` that `fastmcp` 3.x refuses, so it has its own locked venv (`--excel-venv`), as
# `uvx` would isolate it.
EXCEL_EXECUTABLE = "excel-mcp-server"
EVALUATIONS = {"passed", "failed", "error"}


def use_upstream(code):
    code = os.path.abspath(code)
    sys.path.insert(0, code)
    os.chdir(code)
    # Upstream's runner calls `load_dotenv()` at import, which walks up from its own directory and would load any
    # `.env` it finds (credentials included). The seam's environment is the only one upstream gets.
    import dotenv

    dotenv.load_dotenv = lambda *args, **kwargs: False
    return code


def self_check(code):
    missing = []
    for path, lines in UPSTREAM_LINES.items():
        with open(os.path.join(code, path), encoding="utf-8") as source:
            text = source.read()
        missing += [f"{path}: {line}" for line in lines if line not in text]
    if missing:
        raise SystemExit("seam self-check failed:\n" + "\n".join(missing))
    return {"ok": True, "checked": sum(len(lines) for lines in UPSTREAM_LINES.values())}


def pin_server(name, server, venv, node_modules, excel_venv):
    """One server's stdio config with its command rewritten to the locked install. Unknown commands are refused."""
    command, args = server["command"], list(server.get("args", []))
    python = os.path.join(venv, "bin", "python")
    if command == "python":
        pinned = [python, *args]
    elif command == "uv" and args[:1] == ["--directory"] and args[2:4] == ["run", "python"]:
        # `uv --directory <root> run python <script> ...`: the same script, from <root>, on the locked venv.
        server = {**server, "cwd": server.get("cwd") or args[1]}
        pinned = [python, *args[4:]]
    elif command == "uvx" and args and args[0] in VENV_EXECUTABLES:
        pinned = [os.path.join(venv, "bin", args[0]), *args[1:]]
    elif command == "npx" and args and args[0] in NPX_BINS:
        pinned = [os.path.join(node_modules, ".bin", NPX_BINS[args[0]]), *args[1:]]
    elif command == EXCEL_EXECUTABLE:
        pinned = [os.path.join(excel_venv, "bin", command), *args]
    else:
        raise SystemExit(f"seam: refused server {name}: command {command!r} {args[:1]!r} is not pinned")
    if not os.path.exists(pinned[0]):
        raise SystemExit(f"seam: server {name}: {pinned[0]} is missing from the locked install")
    return {**server, "command": pinned[0], "args": pinned[1:]}


def load_instance(config_file, index):
    with open(config_file, encoding="utf-8") as source:
        configurations = json.load(source)["configurations"]
    if not 0 <= index < len(configurations):
        raise SystemExit(f"seam: config index {index} out of range ({len(configurations)})")
    return configurations[index]


@contextlib.contextmanager
def quiet():
    """Upstream prints freely; the protocol owns stdout, so everything else goes to stderr."""
    with contextlib.redirect_stdout(sys.stderr):
        yield


def open_instance(args):
    """Build the instance exactly as `run_single_task` does, up to `env.reset()`."""
    use_upstream(args.code)
    with quiet():
        from inference.run_react import dynamic_import_class, setup_mcp_servers
        from gem.tools.mcp_tool import MCPTool
        from gem.tools.tool_env_wrapper import ToolEnvWrapperOpenAI

        config = load_instance(args.config, args.index)
        task_workspace = os.path.abspath(args.workspace)
        agent_workspace = os.path.join(task_workspace, "agent_workspace")
        for path in (os.path.join(task_workspace, "local_db"), agent_workspace, os.path.join(agent_workspace, "memory")):
            os.makedirs(path, exist_ok=True)
        env_params = {}
        for key, value in config["env_params"].items():
            if isinstance(value, str):
                value = value.replace("{task_workspace}", task_workspace).replace("{agent_workspace}", agent_workspace)
            env_params[key] = value
        env_params.setdefault("task_dir", task_workspace)
        if "seed" not in env_params:
            raise SystemExit("seam: the instance names no seed; LOCA would draw one at random")
        env = dynamic_import_class(config["env_class"])(**env_params)
        from pathlib import Path

        mcp_config = setup_mcp_servers(json.loads(json.dumps(config["mcp_servers"])), Path(task_workspace), Path(agent_workspace))
        mcp_config["mcpServers"] = {
            name: pin_server(name, server, args.venv, args.node_modules, args.excel_venv) for name, server in mcp_config["mcpServers"].items()
        }
        tool = MCPTool(mcp_config, validate_on_init=False, execution_timeout=120.0, fix_schema_for_openai=False)
        env = ToolEnvWrapperOpenAI(env, tools=[tool], max_tool_uses=args.max_tool_uses)
        obs, info, user_prompt, tools = env.reset()
    assert_preprocessed(task_workspace)
    return {"config": config, "env": env, "tool": tool, "prompt": user_prompt, "tools": tools[0] if tools else []}


def assert_preprocessed(task_workspace):
    """Upstream's `reset` logs a failed preprocessing step and returns the prompt anyway; such an instance is refused."""
    logs = os.path.join(task_workspace, "logs")
    for name in sorted(os.listdir(logs)) if os.path.isdir(logs) else []:
        with open(os.path.join(logs, name), encoding="utf-8", errors="replace") as log:
            if " - ERROR - " in log.read():
                raise SystemExit(f"seam: preprocessing logged an error ({name}); the instance is refused")


def pinned_setup(setup, args):
    """Upstream's `setup_mcp_servers`, with every server command pinned (for the unmodified ReAct loop)."""

    def wrapped(mcp_configs, task_workspace, agent_workspace):
        config = setup(mcp_configs, task_workspace, agent_workspace)
        config["mcpServers"] = {
            name: pin_server(name, server, args.venv, args.node_modules, args.excel_venv) for name, server in config["mcpServers"].items()
        }
        return config

    return wrapped


def react(args):
    """`loca-react`: upstream's own `run_single_task` (the ReAct scaffold), unmodified but for pinned server commands,
    against the endpoint `LOCA_REACT_BASE_URL` names (the local pass-through). Prints counts and the reward only."""
    use_upstream(args.code)
    with quiet():
        import inference.run_react as runner

        runner.setup_mcp_servers = pinned_setup(runner.setup_mcp_servers, args)
        config = load_instance(args.config, args.index)
        workspace = os.path.abspath(args.workspace)
        os.makedirs(workspace, exist_ok=True)
        result = runner.run_single_task(
            task_id=args.index,
            config_id=args.index,
            run_id=0,
            base_task_dir=os.path.dirname(workspace),
            output_dir=os.path.join(workspace, "react-output"),
            env_class=config["env_class"],
            env_params=config["env_params"],
            mcp_configs=json.loads(json.dumps(config["mcp_servers"])),
            api_key=os.environ["LOCA_REACT_API_KEY"],
            base_url=os.environ["LOCA_REACT_BASE_URL"],
            model=args.model,
            max_tool_uses=args.max_tool_uses,
            max_tokens=args.max_tokens,
            timeout=600,
            max_context_size=args.max_context_size,
            config_name=os.path.basename(workspace),
        )
    task_workspace = os.path.join(os.path.dirname(workspace), os.path.basename(workspace), "state0")
    stats_file = os.path.join(task_workspace, "token_stats.json")
    trims = 0
    trajectory = os.path.join(task_workspace, "trajectory.json")
    api_error = False
    if os.path.exists(trajectory):
        with open(trajectory, encoding="utf-8") as source:
            data = json.load(source)
        trims = len((data.get("events") or {}).get("trim") or [])
        last = (data.get("messages") or [{}])[-1]
        api_error = str(last.get("content") or "").startswith("API Error")
    if api_error:
        # A provider fault, not an outcome: no row (exit 3); the pilot runs the instance again.
        sys.exit(3)
    prompt_tokens = completion_tokens = cached_tokens = 0
    if os.path.exists(stats_file):
        with open(stats_file, encoding="utf-8") as source:
            for row in json.load(source).get("usage_tracking") or []:
                prompt_tokens += int(row.get("prompt_tokens") or 0)
                completion_tokens += int(row.get("completion_tokens") or 0)
                cached_tokens += int(row.get("prompt_cache_hit_tokens") or 0)
    print(json.dumps({
        "status": result.get("status"),
        "reward": float(result.get("accuracy") or 0),
        "steps": result.get("steps"),
        "toolCalls": result.get("tool_calls"),
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "trimmedTokens": result.get("trimmed_tokens"),
        "trims": trims,
        "tokenStats": os.path.exists(stats_file),
    }))


def evaluation_of(info, reward):
    status = (info or {}).get("evaluation")
    if status not in EVALUATIONS:
        status = "passed" if reward and float(reward) >= 1 else "failed"
    return status


def serve(args):
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", buffering=1, encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())  # Child servers inherit fd 1: keep them off the protocol.

    def send(message):
        protocol.write(json.dumps(message, ensure_ascii=False) + "\n")
        protocol.flush()

    instance = open_instance(args)
    env = instance["env"]
    send({"op": "ready", "name": instance["config"]["name"], "seed": instance["config"]["env_params"].get("seed"),
          "prompt": instance["prompt"], "tools": instance["tools"]})
    done = None
    calls = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        message = json.loads(line)
        op = message.get("op")
        if op == "call":
            if done is not None:
                send({"op": "result", "id": message.get("id"), "content": "The task has already ended.", "terminated": True})
                continue
            calls += 1
            action = {"type": "tool", "data": [{"id": str(message["id"]), "type": "function", "function": {
                "name": message["name"], "arguments": json.dumps(message.get("arguments") or {})}}]}
            with quiet():
                observation, reward, terminated, truncated, info = env.step_openai(action, verbose=False)
            if terminated or truncated:
                done = {"reward": float(reward or 0), "evaluation": evaluation_of(info, reward), "claimed": True,
                        "truncated": bool(truncated and not terminated)}
                content = observation if isinstance(observation, str) else json.dumps(observation)
            else:
                results = json.loads(observation)
                content = results[0]["content"] if results else ""
            send({"op": "result", "id": message.get("id"), "content": content, "terminated": done is not None})
        elif op == "finish":
            if done is None:
                # LOCA's ReAct loop: an answer without a tool call goes to `env.step`, which evaluates.
                text = str(message.get("text") or "")
                action = {"type": "normal", "data": [text]}
                with quiet():
                    observation, reward, terminated, truncated, info = env.step_openai(action, verbose=False)
                done = {"reward": float(reward or 0), "evaluation": evaluation_of(info, reward), "claimed": False,
                        "truncated": False}
            send({"op": "finished", "calls": calls, **done})
            break
        else:
            send({"op": "error", "code": "unknown-op"})
    with quiet(), contextlib.suppress(Exception):
        instance["tool"].close()


def tools_only(args):
    instance = open_instance(args)
    print(json.dumps({"name": instance["config"]["name"], "promptChars": len(instance["prompt"]),
                      "tools": [tool["function"]["name"] for tool in instance["tools"]]}))
    with contextlib.suppress(Exception):
        instance["tool"].close()


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("self-check")
    check.add_argument("--code", required=True)
    for name in ("serve", "tools", "react"):
        p = sub.add_parser(name)
        p.add_argument("--code", required=True)
        p.add_argument("--config", required=True)
        p.add_argument("--index", type=int, required=True)
        p.add_argument("--workspace", required=True)
        p.add_argument("--venv", required=True)
        p.add_argument("--node-modules", required=True)
        p.add_argument("--excel-venv", required=True)
        p.add_argument("--max-tool-uses", type=int, default=500)
        if name == "react":
            p.add_argument("--model", required=True)
            p.add_argument("--max-tokens", type=int, required=True)
            p.add_argument("--max-context-size", type=int, required=True)
    args = parser.parse_args()
    if args.command == "self-check":
        print(json.dumps(self_check(os.path.abspath(args.code))))
    elif args.command == "tools":
        tools_only(args)
    elif args.command == "react":
        react(args)
    else:
        serve(args)


if __name__ == "__main__":
    main()
