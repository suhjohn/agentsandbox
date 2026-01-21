#!/usr/bin/env python3
from __future__ import annotations

import os
from dataclasses import dataclass

from _shared import connect_active_page, has_flag, positional_args, print_result, run_cli


@dataclass
class EvalArgs:
    expression: str


@dataclass
class EvalResult:
    value: object


def usage() -> None:
    print("Usage: eval.py 'code'")


def evaluate_expression(args: EvalArgs, argv: list[str]) -> EvalResult:
    conn = connect_active_page(argv)
    try:
        value = conn.session.evaluate(args.expression, await_promise=True, return_by_value=True)
        return EvalResult(value=value)
    finally:
        conn.close()


def run_eval_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    expression = " ".join(positional_args(argv)).strip()
    if not expression:
        usage()
        return 1

    result = evaluate_expression(EvalArgs(expression=expression), argv)
    print_result(result.value)
    return 0


if __name__ == "__main__":
    run_cli(run_eval_cli)
