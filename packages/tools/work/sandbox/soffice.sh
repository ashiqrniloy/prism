#!/bin/sh
set -eu
for arg in "$@"; do
  case "$arg" in
    --accept|--accept=*|*[Mm]acro*)
      echo "soffice macro/socket flags refused" >&2
      exit 2
      ;;
  esac
done
mkdir -p /tmp/lo-profile
exec /usr/bin/soffice -env:UserInstallation=file:///tmp/lo-profile --headless --norestore --nologo --nolockcheck "$@"
