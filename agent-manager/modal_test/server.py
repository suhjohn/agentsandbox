import os
import pathlib
import subprocess
import sys

import modal

APP_NAME = os.environ.get("MODAL_AGENT_ROOTFS_APP", "agent-rootfs-test-server-2")
VOLUME_NAME = os.environ.get("MODAL_AGENT_ROOTFS_VOLUME", "agent-rootfs-test-volume-2")
AGENT_ID = os.environ.get("AGENT_ID", "default")
AGENT_PORT = int(os.environ.get("MODAL_AGENT_PORT", "3131"))
BASE_IMAGE_REF = os.environ.get("AGENT_BASE_IMAGE_REF", "ghcr.io/suhjohn/agent:9a2ba3a")

print(f"BASE_IMAGE_REF: {BASE_IMAGE_REF}")
DOTENV_PATH = (pathlib.Path(__file__).resolve().parent.parent.parent / "agent-go" / ".env")
SECRETS = [modal.Secret.from_dotenv(path=str(DOTENV_PATH))]

rootfs_volume = modal.Volume.from_name(
    VOLUME_NAME,
    create_if_missing=True,
)

VOLUME_MOUNT = "/mnt/agent-home"

agent_image = modal.Image.from_registry(
    BASE_IMAGE_REF,
).run_commands("rm -rf /home/agent && ln -s /mnt/agent-home /home/agent")

app = modal.App(APP_NAME)
envs = {
    "AGENT_ID": AGENT_ID,
    "AGENT_HOME": '/home/agent',
    "WORKSPACES_DIR": '/home/agent/workspaces',
    "HOME": '/home/agent',
    "AGENT_RUNTIME_MODE": 'server',
}

@app.function(
    image=agent_image,
    volumes={VOLUME_MOUNT: rootfs_volume},
    timeout=60 * 60,
    secrets=SECRETS,
    env=envs,
    min_containers=1,
    max_containers=1,
)
@modal.concurrent(max_inputs=100)
@modal.web_server(AGENT_PORT)
def fastapi_app():
    agent_bin = pathlib.Path("/home/agent") / "agent-server"
    proc = subprocess.Popen(
        [
            str(agent_bin),
            "serve",
            "-port",
            str(AGENT_PORT),
        ],
        cwd="/home/agent",
    )
