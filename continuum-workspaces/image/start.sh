#!/bin/bash
# Starts a Continuum workspace: the repository in /home/workspace/<name>
# (cloned the first time), git set up to push with the user's GitHub sign-in
# (held only in this container's environment), then the editor.
set -eu

: "${GIT_REPO:?}" "${CONNECTION_TOKEN:?}" "${BASE_PATH:?}"
NAME="${GIT_REPO#*/}"
DIR="/home/workspace/$NAME"

git config --global user.name "${GIT_AUTHOR_NAME:-Continuum user}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-user@continuum.local}"
git config --global init.defaultBranch main
# GitHub's password for git is the sign-in token, read from the environment when needed (never written to disk)
git config --global credential.https://github.com.helper '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'

if [ ! -d "$DIR/.git" ]; then
  git clone "https://github.com/$GIT_REPO.git" "$DIR" || mkdir -p "$DIR"
fi

# The access token as a file only the editor reads (not on its command line)
TOKEN_FILE="$(mktemp)"
printf '%s' "$CONNECTION_TOKEN" > "$TOKEN_FILE"
unset CONNECTION_TOKEN

# The editor stays the main process; its output goes to the log with the access token hidden
# (it prints its address, token included, when it starts)
exec /home/.openvscode-server/bin/openvscode-server \
  --host 0.0.0.0 --port 3000 \
  --connection-token-file "$TOKEN_FILE" \
  --server-base-path "$BASE_PATH" \
  --default-folder "$DIR" \
  --telemetry-level off \
  > >(sed -u -E 's/tkn=[A-Za-z0-9_-]+/tkn=[hidden]/g') 2>&1
