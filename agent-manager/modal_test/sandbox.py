"""
Start a sandbox from the agent image, run the entrypoint in init mode
to set up Codex/Pi/runtime state under /home/agent, then copy that
into a Modal volume.

Modal sandboxes run as root and don't execute the image ENTRYPOINT,
so we invoke agent-entrypoint --init manually.
"""
import modal
import os
import sys
from dotenv import load_dotenv

load_dotenv()

BASE_IMAGE_REF = os.environ.get("AGENT_BASE_IMAGE_REF", "ghcr.io/suhjohn/agent:9a2ba3a")
VOLUME_NAME = os.environ.get("MODAL_AGENT_ROOTFS_VOLUME", "agent-rootfs-test-volume-2")
VOLUME_MOUNT = "/mnt/rootfs"
AGENT_HOME = "/home/agent"

app = modal.App.lookup("volume-create-test", create_if_missing=True)
image = modal.Image.from_registry(BASE_IMAGE_REF)
vol = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

print(f"Image  : {BASE_IMAGE_REF}")
print(f"Volume : {VOLUME_NAME}  →  mounted at {VOLUME_MOUNT}")
print()

with modal.enable_output():
    sb = modal.Sandbox.create(
        image=image,
        app=app,
        volumes={VOLUME_MOUNT: vol},
        timeout=10 * 60,
        secrets=[modal.Secret.from_dict({
            "AGENT_ID": os.environ.get("AGENT_ID", "snapshot"),
            "SECRET_SEED": os.environ["SECRET_SEED"],
        })],
        env= {
            "AGENT_HOME": '/home/agent',
        }
    )


def run(cmd: str, label: str | None = None):
    p = sb.exec("bash", "-c", cmd)
    for line in p.stdout:
        print(line, end="")
    err = p.stderr.read()
    if err:
        print(err, end="")
    p.wait()
    if p.returncode != 0:
        print(f"\n{'[' + label + '] ' if label else ''}Failed (exit {p.returncode})", file=sys.stderr)
        sys.exit(1)


try:
    # 1. Run entrypoint in init mode — creates /home/agent tree,
    #    CODEX_HOME, PI_CODING_AGENT_DIR, workspace tools, AGENTS.md, etc.
    print("Running agent-entrypoint --init …")
    run("/usr/local/bin/agent-entrypoint --init", "init")

    # 2. Copy agent-server launcher into /home/agent
    print("Copying /app/agent-server → /home/agent …")
    run(f"cp /app/agent-server {AGENT_HOME}/agent-server", "copy-launcher")

    # 3. Show what was created
    print("\n--- /home/agent after init ---")
    run(f"find {AGENT_HOME} -maxdepth 3 -type f | head -40", "ls")
    print("---\n")

    # 4. Clear volume, then copy /home/agent into it
    print(f"Clearing {VOLUME_MOUNT} …")
    run(f"rm -rf {VOLUME_MOUNT}/* {VOLUME_MOUNT}/.[!.]* {VOLUME_MOUNT}/..?*", "clean")

    print(f"Copying {AGENT_HOME} → {VOLUME_MOUNT} …")
    run(f"cp -a {AGENT_HOME}/. {VOLUME_MOUNT}/", "copy")

    # 5. Verify
    print(f"\n--- {VOLUME_MOUNT} contents ---")
    run(f"ls -la {VOLUME_MOUNT}/", "verify")
    print("---\n")

    print(f"\n--- {VOLUME_MOUNT}/.codex contents ---")
    run(f"ls -la {VOLUME_MOUNT}/.codex", "verify-codex")
    print("---\n")

    # 6. Persist
    print("Syncing volume …")
    sync_p = sb.exec("sync", VOLUME_MOUNT)
    sync_p.wait()
    if sync_p.returncode != 0:
        print("  sync returned non-zero, calling vol.commit() …")
        vol.commit()

    print("Done.")

finally:
    sb.terminate()
    print(f"Sandbox {sb.object_id} terminated.")
