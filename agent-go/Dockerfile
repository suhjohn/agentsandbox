FROM ubuntu:24.04

ARG AGENT_REPO_DIR=/opt/agentsandbox

COPY . ${AGENT_REPO_DIR}

WORKDIR ${AGENT_REPO_DIR}/agent-go

RUN chmod +x docker/env.sh docker/setup.sh docker/start.sh docker/docker-wrapper.sh docker/runit/*.sh \
  && bash docker/setup.sh

CMD ["sleep", "infinity"]
