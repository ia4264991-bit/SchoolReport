#!/usr/bin/env bash
# OPTIONAL: creates the CloudFront firewall (AWS WAF, about US$10/month) and prints its ARN.
# Put the ARN in params.<env>.json as WebAclArn, then run deploy-stack.sh to attach it.
#
# CloudFront firewalls must live in us-east-1, and the project policy blocks CloudFormation
# there, so this uses the WAF API directly. Re-running it does nothing if the ACL exists.
set -euo pipefail
export MSYS_NO_PATHCONV=1
PROFILE="${AWS_PROFILE:-schoolreport}"
ENV_NAME="${ENV_NAME:-prod}"
NAME="schoolreport-$ENV_NAME-edge"
AWS=(aws --profile "$PROFILE" --region us-east-1 wafv2)

EXISTING=$("${AWS[@]}" list-web-acls --scope CLOUDFRONT --query "WebACLs[?Name=='$NAME'].ARN" --output text)
if [ -n "$EXISTING" ] && [ "$EXISTING" != None ]; then
  echo "Already exists: $EXISTING"
  exit 0
fi

vis() { echo "{\"SampledRequestsEnabled\":true,\"CloudWatchMetricsEnabled\":true,\"MetricName\":\"$1\"}"; }
managed() { # name priority group [overrides-json]
  echo "{\"Name\":\"$1\",\"Priority\":$2,\"OverrideAction\":{\"None\":{}},\"VisibilityConfig\":$(vis "$1"),
    \"Statement\":{\"ManagedRuleGroupStatement\":{\"VendorName\":\"AWS\",\"Name\":\"$3\"${4:+,\"RuleActionOverrides\":$4}}}}"
}

RULES=$(cat <<EOF
[
  $(managed aws-common 0 AWSManagedRulesCommonRuleSet '[{"Name":"SizeRestrictions_BODY","ActionToUse":{"Count":{}}}]'),
  $(managed aws-known-bad-inputs 1 AWSManagedRulesKnownBadInputsRuleSet),
  $(managed aws-ip-reputation 2 AWSManagedRulesAmazonIpReputationList),
  {"Name":"login-rate","Priority":3,"Action":{"Block":{}},"VisibilityConfig":$(vis login-rate),
   "Statement":{"RateBasedStatement":{"Limit":300,"EvaluationWindowSec":300,"AggregateKeyType":"IP",
     "ScopeDownStatement":{"ByteMatchStatement":{"FieldToMatch":{"UriPath":{}},"PositionalConstraint":"STARTS_WITH",
       "SearchString":"/api/auth/","TextTransformations":[{"Priority":0,"Type":"NONE"}]}}}}},
  {"Name":"overall-rate","Priority":4,"Action":{"Block":{}},"VisibilityConfig":$(vis overall-rate),
   "Statement":{"RateBasedStatement":{"Limit":5000,"EvaluationWindowSec":300,"AggregateKeyType":"IP"}}}
]
EOF
)

TMP=$(mktemp)
printf '%s' "$RULES" >"$TMP"
ARN=$("${AWS[@]}" create-web-acl --name "$NAME" --scope CLOUDFRONT \
  --default-action Allow={} \
  --visibility-config "$(vis "$NAME")" \
  --rules "file://$(cygpath -w "$TMP")" \
  --description "SchoolReport $ENV_NAME API firewall" \
  --query Summary.ARN --output text)
rm -f "$TMP"
echo "Created: $ARN"
echo "Next: set WebAclArn to this value in infra/aws/params.$ENV_NAME.json and run ./infra/aws/deploy-stack.sh"
