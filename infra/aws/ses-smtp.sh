#!/usr/bin/env bash
# Creates — or rotates — the Amazon SES SMTP login the API uses to send email.
#   ./infra/aws/ses-smtp.sh            # first time: IAM user + key + secret
#   ./infra/aws/ses-smtp.sh --rotate   # new key, update the secret, delete the old key
#
# The IAM user may ONLY send email through SES, ONLY as no-reply@<domain>. Its access key is
# turned into the SES SMTP password (AWS's documented SigV4 derivation) and stored straight
# in Secrets Manager as {"username","password"}; nothing secret is printed or written to disk.
# Afterwards: put the secret ARN in params.<env>.json (SmtpSecretArn), run deploy-stack.sh and
# release.sh so the server picks it up.
set -euo pipefail
export MSYS_NO_PATHCONV=1

PROFILE="${AWS_PROFILE:-schoolreport}"
ENV_NAME="${ENV_NAME:-prod}"
DOMAIN="${DOMAIN:-schoolreport.online}"
FROM="no-reply@$DOMAIN"
REGION="$(aws configure get region --profile "$PROFILE")"
USER="schoolreport-$ENV_NAME-ses-smtp"
SECRET="schoolreport/$ENV_NAME/smtp"
AWS=(aws --profile "$PROFILE" --region "$REGION")
ACCOUNT=$("${AWS[@]}" sts get-caller-identity --query Account --output text)

if ! "${AWS[@]}" iam get-user --user-name "$USER" >/dev/null 2>&1; then
  "${AWS[@]}" iam create-user --user-name "$USER" --tags Key=app,Value=schoolreport "Key=env,Value=$ENV_NAME" >/dev/null
  echo "IAM user $USER created (send-only)"
fi
POLICY=$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"SendAsNoReplyOnly","Effect":"Allow","Action":"ses:SendRawEmail",
 "Resource":"arn:aws:ses:$REGION:$ACCOUNT:identity/$DOMAIN",
 "Condition":{"StringEquals":{"ses:FromAddress":"$FROM"}}}]}
EOF
)
"${AWS[@]}" iam put-user-policy --user-name "$USER" --policy-name ses-send-as-noreply --policy-document "$POLICY"

OLD_KEYS=$("${AWS[@]}" iam list-access-keys --user-name "$USER" --query 'AccessKeyMetadata[].AccessKeyId' --output text)
if [ -n "$OLD_KEYS" ] && [ "${1:-}" != "--rotate" ]; then
  echo "User already has a key ($OLD_KEYS). Use --rotate to replace it." >&2
  exit 1
fi

# New key → SMTP password, computed in memory (shell variable only, never on disk or screen).
LOGIN=$("${AWS[@]}" iam create-access-key --user-name "$USER" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text |
node -e '
  const crypto = require("crypto")
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const [id, secret] = s.trim().split(/\s+/)
    const hmac = (key, msg) => crypto.createHmac("sha256", key).update(msg).digest()
    let k = hmac("AWS4" + secret, "11111111")
    for (const part of [process.argv[1], "ses", "aws4_request", "SendRawEmail"]) k = hmac(k, part)
    const password = Buffer.concat([Buffer.from([0x04]), k]).toString("base64")
    process.stdout.write(JSON.stringify({ username: id, password }))
  })' "$REGION")
[ -n "$LOGIN" ] || { echo "Could not create the SMTP login" >&2; exit 1; }
if "${AWS[@]}" secretsmanager describe-secret --secret-id "$SECRET" >/dev/null 2>&1; then
  "${AWS[@]}" secretsmanager put-secret-value --secret-id "$SECRET" --secret-string "$LOGIN" >/dev/null
else
  "${AWS[@]}" secretsmanager create-secret --name "$SECRET" --description "SchoolReport $ENV_NAME SES SMTP login (send-only, $FROM)" \
    --secret-string "$LOGIN" --tags Key=app,Value=schoolreport >/dev/null
fi
unset LOGIN
echo "SMTP login stored in Secrets Manager ($SECRET)"

if [ -n "$OLD_KEYS" ]; then
  for k in $OLD_KEYS; do "${AWS[@]}" iam delete-access-key --user-name "$USER" --access-key-id "$k"; echo "old key $k deleted"; done
  echo "Rotated. Run release.sh so the server uses the new password."
fi
echo "SmtpSecretArn: $("${AWS[@]}" secretsmanager describe-secret --secret-id "$SECRET" --query ARN --output text)"
echo "SmtpHost:      email-smtp.$REGION.amazonaws.com"
echo "EmailFrom:     \"SchoolReport\" <$FROM>"
