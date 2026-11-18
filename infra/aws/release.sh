#!/usr/bin/env bash
# Ships committed backend code to the API server. Run from Git Bash on your PC:
#   ./infra/aws/release.sh            # deploy HEAD (must be committed)
#   ./infra/aws/release.sh <release>  # roll back to an earlier release id (already on the server)
#
# Uploads only a small source archive (~200 KB) to S3; the server builds the image itself,
# so nothing large goes over a slow connection.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # keep /opt/... paths intact in Git Bash

PROFILE="${AWS_PROFILE:-schoolreport}"
ENV_NAME="${ENV_NAME:-prod}"
STACK="${STACK:-schoolreport-$ENV_NAME}"
REGION="$(aws configure get region --profile "$PROFILE")"
AWS=(aws --profile "$PROFILE" --region "$REGION")

cd "$(git rev-parse --show-toplevel)"
out() { "${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(out ArtifactsBucketName)
INSTANCE=$(out InstanceId)
API=$(out ApiUrl)

if [ $# -ge 1 ]; then
  RELEASE="$1"
  echo "Rolling back to release $RELEASE (must still be on the server)."
  COMMANDS=$(printf '%s\n' \
    'set -euo pipefail' \
    "ENV_NAME=$ENV_NAME bash /opt/schoolreport/releases/$RELEASE/infra/server/deploy.sh $RELEASE")
else
  if [ -n "$(git status --porcelain -- schoolreport-ges-backend-fixed infra/server)" ]; then
    echo "Uncommitted backend changes. Commit first, so every release matches a commit." >&2
    exit 1
  fi
  SHA=$(git rev-parse --short=12 HEAD)
  RELEASE="$(date -u +%Y%m%d-%H%M)-$SHA"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  git archive --format=tar.gz -o "$(cygpath -w "$TMP/$RELEASE.tar.gz")" HEAD schoolreport-ges-backend-fixed infra/server
  echo "Uploading $RELEASE ($(du -h "$TMP/$RELEASE.tar.gz" | cut -f1))"
  "${AWS[@]}" s3 cp --only-show-errors "$(cygpath -w "$TMP/$RELEASE.tar.gz")" "s3://$BUCKET/releases/$RELEASE.tar.gz"
  COMMANDS=$(printf '%s\n' \
    'set -euo pipefail' \
    "mkdir -p /opt/schoolreport/releases/$RELEASE" \
    "aws s3 cp --only-show-errors --region $REGION s3://$BUCKET/releases/$RELEASE.tar.gz /tmp/$RELEASE.tar.gz" \
    "tar -xzf /tmp/$RELEASE.tar.gz -C /opt/schoolreport/releases/$RELEASE" \
    "rm -f /tmp/$RELEASE.tar.gz" \
    "ENV_NAME=$ENV_NAME bash /opt/schoolreport/releases/$RELEASE/infra/server/deploy.sh $RELEASE")
fi

PARAMS=$(mktemp)
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({commands:process.argv[2].trim().split("\n"),executionTimeout:["1800"]}))' "$(cygpath -w "$PARAMS")" "$COMMANDS"
CMD_ID=$("${AWS[@]}" ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --comment "deploy $RELEASE" --parameters "file://$(cygpath -w "$PARAMS")" \
  --query Command.CommandId --output text)
rm -f "$PARAMS"
echo "Deploying on $INSTANCE (command $CMD_ID) — first deploy takes a few minutes (image build)…"

STATUS=Pending
for _ in $(seq 1 180); do
  sleep 5
  STATUS=$("${AWS[@]}" ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Pending|InProgress|Delayed) continue ;; *) break ;; esac
done
"${AWS[@]}" ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text
echo "Server result: $STATUS"
[ "$STATUS" = Success ] || exit 1

LIVE=$(curl -fsS "$API/api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
echo "Live version at $API: $LIVE"
[ "$LIVE" = "$RELEASE" ] || { echo "Live version does not match $RELEASE" >&2; exit 1; }
echo "Done. Roll back with: ./infra/aws/release.sh <previous-release-id>"
