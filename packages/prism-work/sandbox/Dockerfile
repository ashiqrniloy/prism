# Work sandbox image. Host builds and pins: `name@sha256:<64-hex>`.
# Prism never pulls this image. Runtime network is none (createDockerSandbox).
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm

COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN apt-get update && apt-get install -y --no-install-recommends \
      passwd \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      poppler-utils \
      zip \
      unzip \
      fonts-liberation \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --break-system-packages --no-cache-dir \
      python-docx==1.1.2 \
      openpyxl==3.1.5 \
      python-pptx==1.0.2 \
    && groupadd --gid 65532 nonroot \
    && useradd --uid 65532 --gid 65532 --home-dir /home/nonroot --create-home --shell /usr/sbin/nologin nonroot \
    && mkdir -p /opt/prism-work/skills /workspace \
    && chown -R 65532:65532 /opt/prism-work /workspace /home/nonroot

COPY sandbox/soffice.sh /usr/local/bin/soffice
RUN chmod 755 /usr/local/bin/soffice
COPY vendor/hermes-agent /opt/prism-work/skills
RUN chown -R 65532:65532 /opt/prism-work/skills

USER 65532:65532
ENV HOME=/home/nonroot
WORKDIR /workspace
