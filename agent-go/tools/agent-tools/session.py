#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys

from api_client import AgentAPIClient


def _print_json(value: object) -> None:
    print(json.dumps(value, indent=2, sort_keys=True))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Session API wrapper CLI for agent-go",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="Create or get a session")
    create.add_argument("session_id")
    create.add_argument("--harness", default="codex")
    create.add_argument("--agent-id", default="default")
    create.add_argument("--model")
    create.add_argument("--model-reasoning-effort")

    subparsers.add_parser("list", help="List sessions")

    get = subparsers.add_parser("get", help="Get one session")
    get.add_argument("session_id")

    message = subparsers.add_parser("message", help="Send message input")
    message.add_argument("session_id")
    message.add_argument("text")
    message.add_argument("--model")
    message.add_argument("--model-reasoning-effort")

    stop = subparsers.add_parser("stop", help="Stop active run")
    stop.add_argument("session_id")

    delete = subparsers.add_parser("delete", help="Delete session")
    delete.add_argument("session_id")

    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    client = AgentAPIClient.from_env()

    if args.command == "create":
        _print_json(
            client.create_session(
                session_id=args.session_id,
                harness=args.harness,
                agent_id=args.agent_id,
                model=args.model,
                model_reasoning_effort=args.model_reasoning_effort,
            )
        )
        return 0

    if args.command == "list":
        _print_json(list(client.list_sessions()))
        return 0

    if args.command == "get":
        _print_json(client.get_session(args.session_id))
        return 0

    if args.command == "message":
        _print_json(
            client.send_message(
                session_id=args.session_id,
                input_items=[client.text_input(args.text)],
                model=args.model,
                model_reasoning_effort=args.model_reasoning_effort,
            )
        )
        return 0

    if args.command == "stop":
        _print_json(client.stop_run(args.session_id))
        return 0

    if args.command == "delete":
        _print_json(client.delete_session(args.session_id))
        return 0

    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001
        print(f"✗ {exc}", file=sys.stderr)
        raise SystemExit(1)
