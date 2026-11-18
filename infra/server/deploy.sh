#!/bin/bash
# Runs ON the API server (as root, through SSM Run Command — see infra/aws/release.sh).
#   deploy.sh <release-id>
# The release must already be unpacked in /opt/schoolreport/releases/<release-id>.
# Re-running it with an older release id is the rollback.
#
# 1. builds the image   2. creates/updates the app database role   3. writes secrets to a
# root-only temp file   4. swaps the container   5. waits for health; restores the previous
# container automatically if the new one is not healthy.
set -euo pipefail

RELEASE="${1:?usage: deploy.sh <release-id>}"
ENV_NAME="${ENV_NAME:-prod}"
ROOT=/opt/schoolreport
DIR="$ROOT/releases/$RELEASE"
NAME=schoolreport-api
IMAGE="schoolreport-api:$RELEASE"
log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

[ -d "$DIR/schoolreport-ges-backend-fixed" ] || { log "release $RELEASE not found in $DIR"; exit 1; }

# Region from instance metadata (IMDSv2).
IMDS_TOKEN=$(curl -sS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
export AWS_DEFAULT_REGION=$(curl -sS -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/placement/region)

CFG=$(aws ssm get-parameter --name "/schoolreport/$ENV_NAME/config" --query Parameter.Value --output text)
cfg() { jq -r --arg k "$1" '.[$k] // ""' <<<"$CFG"; }
secret() { aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text; }

log "building $IMAGE"
docker build --quiet --tag "$IMAGE" "$DIR/schoolreport-ges-backend-fixed" >/dev/null

# Secrets go to a root-only file in /run (memory), removed on exit.
umask 077
RUNDIR=/run/schoolreport
mkdir -p "$RUNDIR"
BOOT_ENV="$RUNDIR/bootstrap.env"
APP_ENV="$RUNDIR/app.env"
trap 'rm -f "$BOOT_ENV" "$APP_ENV"' EXIT

MASTER=$(secret "$(cfg dbMasterSecretArn)")
APP_DB_PASSWORD=$(secret "$(cfg appDbSecretArn)")
ORIGIN_SECRET=$(secret "$(cfg originSecretArn)")

cat >"$BOOT_ENV" <<EOF
PGHOST=$(cfg dbHost)
PGPORT=$(cfg dbPort)
PGUSER=$(jq -r .username <<<"$MASTER")
PGPASSWORD=$(jq -r .password <<<"$MASTER")
DATABASE_SSL_CA=/app/certs/rds-global-bundle.pem
APP_DB_NAME=$(cfg dbName)
APP_DB_USER=$(cfg dbUser)
APP_DB_PASSWORD=$APP_DB_PASSWORD
EOF
log "database bootstrap (app role and database)"
docker run --rm --env-file "$BOOT_ENV" "$IMAGE" node gateway/src/bootstrap-db.js
rm -f "$BOOT_ENV"
unset MASTER

{
  echo "NODE_ENV=production"
  echo "PORT=3000"
  echo "TRUST_PROXY=1"
  echo "LOG_FORMAT=json"
  echo "APP_VERSION=$RELEASE"
  echo "PGHOST=$(cfg dbHost)"
  echo "PGPORT=$(cfg dbPort)"
  echo "PGDATABASE=$(cfg dbName)"
  echo "PGUSER=$(cfg dbUser)"
  echo "PGPASSWORD=$APP_DB_PASSWORD"
  echo "DATABASE_SSL_CA=/app/certs/rds-global-bundle.pem"
  echo "JWT_SECRET=$(secret "$(cfg jwtSecretArn)")"
  echo "ORIGIN_VERIFY_SECRET=$ORIGIN_SECRET"
  echo "SUPERADMIN_EMAIL=$(cfg superadminEmail)"
  echo "SUPERADMIN_PASSWORD=$(secret "$(cfg superadminSecretArn)")"
  echo "FRONTEND_URL=$(cfg frontendUrl)"
  echo "CORS_ORIGINS=$(cfg corsOrigins)"
  if [ -n "$(cfg smtpSecretArn)" ]; then
    SMTP=$(secret "$(cfg smtpSecretArn)")
    echo "SMTP_HOST=$(cfg smtpHost)"
    echo "SMTP_PORT=587"
    echo "SMTP_USER=$(jq -r .username <<<"$SMTP")"
    echo "SMTP_PASS=$(jq -r .password <<<"$SMTP")"
    echo "EMAIL_FROM=$(cfg emailFrom)"
  fi
} >"$APP_ENV"

start() {
  docker run --detach --name "$NAME" \
    --restart unless-stopped \
    --publish 80:3000 \
    --env-file "$APP_ENV" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --cap-drop ALL --security-opt no-new-privileges \
    --memory 1g --pids-limit 256 \
    --log-driver awslogs \
    --log-opt "awslogs-region=$AWS_DEFAULT_REGION" \
    --log-opt "awslogs-group=$(cfg logGroup)" \
    --log-opt "awslogs-stream=api-$RELEASE" \
    "$1" >/dev/null
}

healthy() {
  for _ in $(seq 1 45); do
    if curl -fsS -m 3 -H "X-Origin-Verify: $ORIGIN_SECRET" http://127.0.0.1/api/health/ready >/dev/null 2>&1; then
      return 0
    fi
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "true" ] || return 1
    sleep 2
  done
  return 1
}

HAD_PREVIOUS=no
if docker inspect "$NAME" >/dev/null 2>&1; then
  HAD_PREVIOUS=yes
  docker rm -f "$NAME-previous" >/dev/null 2>&1 || true
  docker rename "$NAME" "$NAME-previous"
  log "stopping previous container"
  docker stop --time 15 "$NAME-previous" >/dev/null
fi

log "starting $IMAGE"
start "$IMAGE"

if healthy; then
  log "healthy: $RELEASE is live"
  [ "$HAD_PREVIOUS" = yes ] && docker rm "$NAME-previous" >/dev/null
  echo "$RELEASE" >"$ROOT/current"
  # Keep the 5 newest releases (and their images) for quick rollback.
  ls -1t "$ROOT/releases" | tail -n +6 | while read -r old; do
    rm -rf "${ROOT:?}/releases/$old"
    docker rmi "schoolreport-api:$old" >/dev/null 2>&1 || true
  done
  docker image prune --force >/dev/null
else
  log "NOT healthy — last log lines:"
  docker logs --tail 40 "$NAME" 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [ "$HAD_PREVIOUS" = yes ]; then
    docker rename "$NAME-previous" "$NAME"
    docker start "$NAME" >/dev/null
    log "previous version restored"
  fi
  exit 1
fi
