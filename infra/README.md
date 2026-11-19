# SchoolReport on AWS — runbook

```
Browser ──> Vercel (React app)
   │
   └── https ──> CloudFront ──(X-Origin-Verify)──> EC2 server :80 ── Docker: API (Node 24)
                 [optional WAF]                       │
                                                      └── TLS ──> RDS PostgreSQL 17 (private)
```

| Piece | Where | Notes |
|---|---|---|
| Stack template | `infra/aws/schoolreport.yaml` | VPC, EC2 (t4g.small), RDS, CloudFront, secrets, alarms, weekly patching |
| Create / update stack | `infra/aws/deploy-stack.sh` | Always through a change set you read first |
| Ship code | `infra/aws/release.sh` | Uploads a ~200 KB source archive; the server builds the image |
| On the server | `infra/server/deploy.sh` | DB role bootstrap, container swap, health check, automatic rollback |
| Firewall (optional) | `infra/aws/waf.sh` | AWS WAF in us-east-1, about US$10/month |

Rough monthly cost (eu-north-1, before credits): EC2 t4g.small ~$13, public IP ~$4, RDS db.t4g.micro + 20 GB ~$15,
Secrets Manager ~$2, CloudFront/logs/S3 ~$1–3 at school scale → **about $35**, plus ~$10 with WAF.

## One-time setup

1. Create the AWS project in AWS Settings and check its Region
   (AWS Settings → View all projects → Overview → Additional Info → Region).
2. Sign the CLI in: `aws login --remote --region <region> --profile schoolreport`
   (open the link in a private browser window and pick the SchoolReport project).
3. `cp infra/aws/params.example.json infra/aws/params.prod.json` and fill it in
   (Vercel address, superadmin email, alarm email). This file is git-ignored.
4. Create the stack:
   ```bash
   ./infra/aws/deploy-stack.sh                    # shows what will be created
   ./infra/aws/deploy-stack.sh --execute <name>   # ~15–25 min
   ```
5. Confirm the "AWS Notification - Subscription Confirmation" email, or alarms go nowhere.
6. First release: `./infra/aws/release.sh` (first build takes a few minutes).
7. Read the first superadmin password once, sign in, change it:
   ```bash
   aws secretsmanager get-secret-value --profile schoolreport \
     --secret-id <SuperadminSecretArn output> --query SecretString --output text
   ```
8. Vercel → Project → Settings → Environment Variables: `VITE_API_URL = <ApiUrl output>/api`, redeploy.

## Everyday

- **Release:** commit, then `./infra/aws/release.sh`. A few seconds of downtime while the container swaps.
  If the new version fails its health check, the previous one is restarted automatically.
- **Roll back:** `./infra/aws/release.sh <earlier-release-id>` (the last 5 stay on the server; ids are printed
  by each release and in `/opt/schoolreport/releases`).
- **Database changes:** add `schoolreport-ges-backend-fixed/shared/migrations/00N_*.sql`; it runs at
  start-up. Take a manual RDS snapshot before a risky migration.
- **Logs:** CloudWatch Logs → `/schoolreport/prod/api` (JSON; search by `reqId` — users see its first
  8 characters as "ref …" on errors).
- **Shell on the server** (no SSH): `aws ssm start-session --profile schoolreport --target <InstanceId>`.
- **Audit:** `GET /api/audit` (school admins: their school; superadmin: all).

## Security scan (HawkScan)

Runs on GitHub, never against production: **Actions → Security scan → Run workflow** (also every
Monday). It starts a fresh API + PostgreSQL on the runner, seeds one demo school
(`scripts/scan-seed.mjs`), and scans it with `stackhawk.yml` + the hand-written
`schoolreport-ges-backend-fixed/openapi.yaml`. Results: StackHawk dashboard, app "SchoolReport", env CI.
Needs the repo secret `HAWK_API_KEY`. **Keep `openapi.yaml` in step with the routes** — a route that is
missing from it is not scanned.

## Email

**Today: Brevo SMTP** (`smtp-relay.brevo.com:587`, TLS required). The login is in the secret
`schoolreport/prod/smtp-brevo` as `{"username":"…","password":"…"}`; `params.prod.json` sets
`SmtpSecretArn` to it, `SmtpHost = smtp-relay.brevo.com` and
`EmailFrom = "SchoolReport" <no-reply@schoolreport.online>`. Brevo's DKIM and DMARC records are in
the Route 53 zone. To change the login: `aws secretsmanager put-secret-value`, then `release.sh`.

**Moving to Amazon SES later** (the domain identity is already verified; production access was
refused once, so open a new Support case: Service limit increase → SES Sending Limits):
1. Once approved, `./infra/aws/ses-smtp.sh` creates a send-only IAM user and stores its SMTP login
   in `schoolreport/prod/smtp`.
2. In `params.prod.json`: `SmtpSecretArn` = that secret, `SmtpHost = email-smtp.<region>.amazonaws.com`;
   run `deploy-stack.sh`, then `release.sh`.

## SMS to parents (Arkesel)

Off until set up (the app then only logs what it would send; notices still show in the parent app).
1. Open an account at arkesel.com, buy SMS credit, register a sender name (max 11 characters, e.g.
   `SchoolRprt`), and create an API key.
2. `aws secretsmanager create-secret --name schoolreport/prod/sms --secret-string '{"apiKey":"…"}'`
   (put the key on the clipboard and paste it into the command; never in chat or files).
3. In `params.prod.json`: `SmsProvider=arkesel`, `SmsSenderId=<sender name>`, `SmsSecretArn=<secret ARN>`;
   `deploy-stack.sh`, then `release.sh`.
Each school has a monthly SMS allowance (default 500), changed per school on the Platform page.

## Online payment (Paystack)

Off until set up. Needs a Paystack business account that has passed verification (live keys).
1. `aws secretsmanager create-secret --name schoolreport/prod/paystack --secret-string '{"secretKey":"sk_live_…"}'`
2. `params.prod.json`: `PaystackSecretArn=<secret ARN>`; `deploy-stack.sh`, then `release.sh`.
3. Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL:
   `https://api.schoolreport.online/api/payments/paystack/webhook`
4. School fees: for each school that wants online fees, create a **subaccount** in Paystack with the
   school's own bank or MoMo account (Paystack sends the money there directly), then paste its code
   (`ACCT_…`) on the Platform page → Plan. The school admin can still switch online fees off.
Subscription prices: `PricePerPupil`, `MinTermPrice`, `TrialDays`, `SubscriptionTermMonths` parameters.

## Custom domain (later)

Request an ACM certificate in us-east-1 for `api.<domain>`, add it and the alias to the CloudFront
distribution, point DNS at CloudFront, update `VITE_API_URL`, `CorsOrigins` and `FrontendUrl`.
The CloudFront → server hop is plain HTTP inside AWS today (no public certificate exists for the
server's AWS hostname); with a domain, add TLS on the server too and set the origin to HTTPS.

## Safety notes

- The database has deletion protection and a final snapshot on delete; the server has termination
  protection. Deleting the stack still needs both switched off first — on purpose.
- Never change `AmiId` casually: it replaces the server (then run `release.sh` again).
- Secrets (database, JWT, origin header, superadmin) are generated by AWS and only read on the server.
