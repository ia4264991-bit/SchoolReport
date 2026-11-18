#!/usr/bin/env bash
# Creates or updates the SchoolReport stack through a change set you read before applying.
#
#   ./infra/aws/deploy-stack.sh                   # make a change set and show what it would do
#   ./infra/aws/deploy-stack.sh --execute <name>  # apply that change set and wait
#
# Parameters come from infra/aws/params.<env>.json (copy params.example.json; it holds no secrets).
# On first create the script also looks up the current Amazon Linux 2023 image and the
# CloudFront prefix list; on updates both keep their previous values, so the server is never
# replaced by accident.
set -euo pipefail
export MSYS_NO_PATHCONV=1

PROFILE="${AWS_PROFILE:-schoolreport}"
ENV_NAME="${ENV_NAME:-prod}"
STACK="${STACK:-schoolreport-$ENV_NAME}"
REGION="$(aws configure get region --profile "$PROFILE")"
AWS=(aws --profile "$PROFILE" --region "$REGION")
cd "$(git rev-parse --show-toplevel)"
TEMPLATE="infra/aws/schoolreport.yaml"
PARAMS_FILE="infra/aws/params.$ENV_NAME.json"

if [ "${1:-}" = "--execute" ]; then
  CS="${2:?change set name}"
  # A stack that has never been created sits in REVIEW_IN_PROGRESS until its first change set runs.
  BEFORE=$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text)
  WAITER=stack-update-complete
  [ "$BEFORE" = REVIEW_IN_PROGRESS ] && WAITER=stack-create-complete
  "${AWS[@]}" cloudformation execute-change-set --stack-name "$STACK" --change-set-name "$CS"
  echo "Applying $CS to $STACK… (a first create takes about 15-25 minutes: the database and CloudFront are slow)"
  if "${AWS[@]}" cloudformation wait "$WAITER" --stack-name "$STACK"; then
    "${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs' --output table
  else
    echo "Stack did not finish cleanly. Recent failures:" >&2
    "${AWS[@]}" cloudformation describe-stack-events --stack-name "$STACK" --max-items 15 \
      --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output table >&2
    exit 1
  fi
  exit 0
fi

[ -f "$PARAMS_FILE" ] || { echo "Missing $PARAMS_FILE — copy infra/aws/params.example.json and fill it in." >&2; exit 1; }

STATUS=$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo NONE)
if [ "$STATUS" != NONE ] && [ "$STATUS" != REVIEW_IN_PROGRESS ]; then
  TYPE=UPDATE
  EXTRA='[{"ParameterKey":"AmiId","UsePreviousValue":true},{"ParameterKey":"CloudFrontPrefixListId","UsePreviousValue":true}]'
else
  TYPE=CREATE
  AMI=$("${AWS[@]}" ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --query Parameter.Value --output text)
  PL=$("${AWS[@]}" ec2 describe-managed-prefix-lists \
    --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
    --query 'PrefixLists[0].PrefixListId' --output text)
  echo "New stack: AMI $AMI, CloudFront prefix list $PL"
  EXTRA="[{\"ParameterKey\":\"AmiId\",\"ParameterValue\":\"$AMI\"},{\"ParameterKey\":\"CloudFrontPrefixListId\",\"ParameterValue\":\"$PL\"},{\"ParameterKey\":\"EnvName\",\"ParameterValue\":\"$ENV_NAME\"}]"
fi

MERGED=$(mktemp)
node -e '
  const fs = require("fs")
  const base = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).filter((p) => !["AmiId","CloudFrontPrefixListId","EnvName"].includes(p.ParameterKey))
  fs.writeFileSync(process.argv[2], JSON.stringify([...base, ...JSON.parse(process.argv[3])]))
' "$PARAMS_FILE" "$MERGED" "$EXTRA"

CS="sr-$(date -u +%Y%m%d-%H%M%S)"
"${AWS[@]}" cloudformation create-change-set --stack-name "$STACK" --change-set-name "$CS" \
  --change-set-type "$TYPE" \
  --template-body "file://$(cygpath -w "$TEMPLATE")" \
  --parameters "file://$(cygpath -w "$MERGED")" \
  --capabilities CAPABILITY_IAM \
  --tags Key=app,Value=schoolreport "Key=env,Value=$ENV_NAME" >/dev/null
rm -f "$MERGED"

if ! "${AWS[@]}" cloudformation wait change-set-create-complete --stack-name "$STACK" --change-set-name "$CS" 2>/dev/null; then
  "${AWS[@]}" cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CS" \
    --query StatusReason --output text >&2
  exit 1
fi

echo
echo "Change set $CS for $STACK ($TYPE) — read it, especially any 'Replacement: True':"
"${AWS[@]}" cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CS" \
  --query 'Changes[].ResourceChange.[Action,LogicalResourceId,ResourceType,Replacement]' --output table
echo
echo "To apply:  ./infra/aws/deploy-stack.sh --execute $CS"
