#!/usr/bin/env python3

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


OPENAPI_PYTHON_CLIENT_VERSION = "0.28.3"


def run(cmd: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    print(f"+ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def mirror_package_dir(source_dir: Path, target_dir: Path) -> None:
    # Only replace the mirrored Python package directory. Preserve sibling files
    # in agent-go/tools/agent-manager-tools such as README.md or local notes.
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    if target_dir.exists():
        shutil.rmtree(target_dir)
    shutil.copytree(source_dir, target_dir)


def main() -> int:
    script_path = Path(__file__).resolve()
    tools_dir = script_path.parents[1]
    repo_root = script_path.parents[2]
    manager_dir = repo_root / "agent-manager"
    package_dir = tools_dir / "src" / "agent_manager_client"
    generated_dir = package_dir / "generated_client"
    mirrored_package_dir = (
        repo_root / "agent-go" / "tools" / "agent-manager-tools" / "agent_manager_client"
    )
    spec_source = manager_dir / "openapi.json"
    top_level_spec_dest = tools_dir / "openapi.json"
    spec_dest = package_dir / "openapi.json"
    config_path = tools_dir / "openapi-python-client.yml"

    run(["bun", "run", "openapi:generate"], cwd=manager_dir)

    if not spec_source.exists():
        raise FileNotFoundError(f"missing generated OpenAPI spec: {spec_source}")

    package_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(spec_source, top_level_spec_dest)
    shutil.copy2(spec_source, spec_dest)
    print(f"copied {spec_source} -> {top_level_spec_dest}")
    print(f"copied {spec_source} -> {spec_dest}")

    if generated_dir.exists():
        shutil.rmtree(generated_dir)

    env = os.environ.copy()
    env.setdefault("RUFF_NO_CACHE", "true")
    run(
        [
            "uvx",
            f"--from=openapi-python-client=={OPENAPI_PYTHON_CLIENT_VERSION}",
            "openapi-python-client",
            "generate",
            "--path",
            str(spec_source),
            "--config",
            str(config_path),
            "--meta",
            "none",
            "--output-path",
            str(generated_dir),
            "--overwrite",
        ],
        cwd=repo_root,
        env=env,
    )

    cache_dir = generated_dir / ".ruff_cache"
    if cache_dir.exists():
        shutil.rmtree(cache_dir)

    mirror_package_dir(package_dir, mirrored_package_dir)
    print(f"copied {package_dir} -> {mirrored_package_dir}")

    print(f"generated Python client in {generated_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
