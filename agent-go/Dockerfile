FROM ubuntu:24.04

ARG AGENT_REPO_DIR=/opt/agentsandbox

COPY . ${AGENT_REPO_DIR}

WORKDIR ${AGENT_REPO_DIR}/agent-go

RUN bash docker/setup.sh

CMD ["sleep", "infinity"]
