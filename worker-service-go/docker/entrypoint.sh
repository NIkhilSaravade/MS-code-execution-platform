#!/bin/sh
# Runs as root (the image no longer sets USER) so it can fix ownership of the
# worker-scratch named volume before handing off to the unprivileged worker
# user. Docker creates a fresh named volume owned by root:root, but the
# worker process (and the source files it writes for sandboxed execution)
# runs as a non-root user - without this, every scratch dir write fails with
# "permission denied".
set -e

mkdir -p /scratch
chown worker:worker /scratch

# /var/run/docker.sock is bind-mounted from the HOST, so it's owned by
# whatever group the host's Docker daemon uses (GID 0/root on this box's
# Docker Desktop, but commonly a differently-numbered "docker" group on
# native Linux) - not anything this image controls. Add the unprivileged
# worker user as a SECONDARY member of that group so it can reach the
# socket, without granting it primary root privileges.
if [ -S /var/run/docker.sock ]; then
	sock_gid="$(stat -c '%g' /var/run/docker.sock)"
	group_name="$(getent group "$sock_gid" | cut -d: -f1)"
	if [ -z "$group_name" ]; then
		group_name=dockersock
		addgroup -g "$sock_gid" "$group_name"
	fi
	addgroup worker "$group_name"
fi

exec su-exec worker /usr/local/bin/worker
