# Pulse-II test platform: set-up runbook

Date: 2 November 2026. Owner: Mohit Chadda. Platform: Caliber Pulse-II (MIS), live at pulse-ll.cmll.in.

This runbook creates a second, separate copy of Pulse-II in Azure, the **test platform**, and switches the release path so that:

- every merge to `main` is built, tested and deployed to the **test platform** (workflow `.github/workflows/main_caliber-mis-test.yml`);
- **production** (`caliber-mis-783`) is deployed only from a release tag `release-YYYY-MM-DD-N`, or a manual run, and only after the owner approves the run in the GitHub environment `production` (workflow `.github/workflows/main_caliber-mis-783.yml`).

The pull request that adds this runbook also contains the two workflows. The Azure subscription that hosts Pulse-II cannot be reached from the build machine, so every command below is for the owner to run. Nothing in it changes a production app setting or touches the production database; section 12 lists exactly what is read and what is never touched.

Time: about two hours of commands, plus the restore (a few minutes per gigabyte). Section 0 says which commands run in Azure Cloud Shell and which on the laptop.

## 0. Before you start

### Where to run what

| Commands | Where | Signed in as |
|---|---|---|
| `az …` | Azure Cloud Shell (bash) at https://shell.azure.com, in the **Pulse-II subscription** `58ca09cf-ab5d-47a8-a438-e1fb2a40d030`. The `az` on the development machine is signed in to a different subscription; do not use it unless you first run `az login` with the owner account and `az account set --subscription 58ca09cf-ab5d-47a8-a438-e1fb2a40d030`. | Owner (subscription Owner or Contributor plus permission to create app registrations) |
| `gh …` | The laptop (PowerShell), where `gh auth status` shows `caliberaitech783-beep` | Repository administrator |
| `node scripts/…` | The laptop, in the repository folder, Node.js 22, after `npm ci` | — |

Cloud Shell forgets shell variables when it times out. Every `az` block below assumes these are set; paste them again after a timeout:

```bash
SUB=58ca09cf-ab5d-47a8-a438-e1fb2a40d030
RG=caliber-mis-test-rg
LOC=centralindia
PLAN=asp-caliber-mis-test
APP=caliber-mis-test-783
PG=caliber-mis-test-pg-783
PG_ADMIN=caliber_test_admin
REPO=caliberaitech783-beep/caliber-mis
az account set --subscription "$SUB"
```

### Names

| Item | Live (never touched) | Test platform (created here) |
|---|---|---|
| Resource group | `coalmine-fleet-maintenance-rg` | `caliber-mis-test-rg` |
| App Service plan | `ASP-coalminefleetmaintenancerg-b234` (Linux, shared with Pulse) | `asp-caliber-mis-test` (Linux, B2 unless section 2 shows a reason to differ) |
| Web App | `caliber-mis-783` | `caliber-mis-test-783` |
| PostgreSQL server | `coalmine-fleet-pg-783` | `caliber-mis-test-pg-783` (Flexible Server, Burstable B1ms) |
| Database | `caliber_mis` | `caliber_mis` (the name is fixed, see below) |
| Address | https://pulse-ll.cmll.in | `https://caliber-mis-test-783.azurewebsites.net` (or the regional address Azure assigns), optionally https://pulse-test.cmll.in |
| Deployment identity | the app registration behind the GitHub secrets `AZUREAPPSERVICE_*` | app registration `github-caliber-mis-test`, Website Contributor on `caliber-mis-test-rg` only |
| GitHub secrets | `AZUREAPPSERVICE_CLIENTID_…`, `…TENANTID_…`, `…SUBSCRIPTIONID_…`, `MIS_GEMINI_API_KEY` | `AZURE_TEST_CLIENT_ID`, `AZURE_TEST_TENANT_ID`, `AZURE_TEST_SUBSCRIPTION_ID`, optional `MIS_TEST_GEMINI_API_KEY` |
| GitHub environment | `production` (required reviewer: the owner) | `test` (no rules) |

If `caliber-mis-test-783` is taken (section 3 checks), pick another name and set the repository variable `PULSE_TEST_WEBAPP_NAME` in section 6. The workflows read their defaults from these names and refuse to run against `caliber-mis-783` or `pulse-ll.cmll.in` whatever the variables say.

### Three rules the server enforces

1. **The database must be named `caliber_mis`.** `mis-database-config.mjs` refuses any other database name, so a second database on the live server is not possible: the test copy needs its **own server**. This also keeps the test copy's credentials useless against the live server.
2. **`MIS_DATABASE_CONNECTION_MODE` must stay unset on the test app.** The live value `shared-admin` pins every connection to the live server and database; with that setting the test app would refuse to start.
3. **`MIS_SCAN_BLOB_ENABLED` must be `false` (or unset) on the test app.** Hot scan storage in Azure Blob is limited to `caliber-mis-783` in `scan-blob-storage.mjs`; any other app refuses to start with it on.

## 1. Before merging the pull request (10 minutes)

Do this first. After the merge, a production release needs both items; without them the production workflow stops at its first step (no reviewer rule) or at the Azure login (no federated credential). Neither item changes the live app.

### 1.1 The `production` environment with you as the required reviewer

Laptop. Save this as `production-environment.json`:

```json
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{"type": "User", "id": 313449839}],
  "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}
}
```

`313449839` is the GitHub user id of `caliberaitech783-beep` (`gh api users/caliberaitech783-beep --jq .id`), the repository administrator. `prevent_self_review` stays `false` because the same person pushes the tag and approves the release. Then:

```bash
gh api --method PUT repos/caliberaitech783-beep/caliber-mis/environments/production --input production-environment.json
```

```bash
gh api --method POST repos/caliberaitech783-beep/caliber-mis/environments/production/deployment-branch-policies -f name='release-*' -f type=tag
```

```bash
gh api --method POST repos/caliberaitech783-beep/caliber-mis/environments/production/deployment-branch-policies -f name=main -f type=branch
```

```bash
gh api repos/caliberaitech783-beep/caliber-mis/environments/production --jq '{rules:[.protection_rules[].type],policy:.deployment_branch_policy}'
```

Expected: `rules` contains `required_reviewers`; the policy has custom branch policies on. The two policies mean only `release-*` tags and `main` (for a manual emergency run) can ever target the environment. The same can be done in the browser: repository **Settings → Environments → production → Required reviewers**.

The production workflow re-checks on every run that the environment still has a required-reviewer rule and refuses to build otherwise, so a rule removed by mistake cannot lead to an unapproved release.

### 1.2 A federated credential for approved production runs

The live deployment identity today has one federated credential, for pushes to `main`. A job that references a GitHub environment presents a different subject, `repo:caliberaitech783-beep/caliber-mis:environment:production`, so the same identity needs one more credential. Cloud Shell:

```bash
az ad app list --all --query "[].{displayName:displayName,appId:appId,objectId:id}" -o table
```

The right registration is the one whose `appId` is the value of the GitHub secret `AZUREAPPSERVICE_CLIENTID_248B6AEDDDF04A74B67402B5BD0DC3EB` (the Azure portal shows it under Web App `caliber-mis-783` → Deployment Center → Settings; the Azure portal created it on 21 October 2026 when the GitHub deployment was set up). Then:

```bash
LIVE_APP_ID=<appId from the table>
LIVE_APP_OBJECT_ID=$(az ad app show --id "$LIVE_APP_ID" --query id -o tsv)
az ad app federated-credential list --id "$LIVE_APP_OBJECT_ID" --query "[].{name:name,subject:subject}" -o table
```

Expected: a credential with subject `repo:caliberaitech783-beep/caliber-mis:ref:refs/heads/main`. Keep it: the `Diagnose MIS deployment` and `Recover stalled MIS App Service` workflows still sign in with it. Add the second one:

```bash
cat > production-environment-credential.json <<'EOF'
{
  "name": "github-production-environment",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:caliberaitech783-beep/caliber-mis:environment:production",
  "description": "Pulse-II production releases approved in the GitHub production environment",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
az ad app federated-credential create --id "$LIVE_APP_OBJECT_ID" --parameters production-environment-credential.json
```

This adds a sign-in rule to the identity. It changes no role assignment, no app setting and nothing on `caliber-mis-783`.

Cost: nothing. Both items are free.

## 2. Read the live set-up (5 minutes, read-only)

These commands only read. They print no secret values: the settings command lists names only.

```bash
az appservice plan show -g coalmine-fleet-maintenance-rg -n ASP-coalminefleetmaintenancerg-b234 --query "{sku:sku.name,tier:sku.tier,instances:sku.capacity,linux:reserved}" -o table
```

```bash
az webapp config show -g coalmine-fleet-maintenance-rg -n caliber-mis-783 --query "{runtime:linuxFxVersion,startup:appCommandLine,alwaysOn:alwaysOn,http20:http20Enabled,minTls:minTlsVersion,ftps:ftpsState}" -o table
```

```bash
az webapp config appsettings list -g coalmine-fleet-maintenance-rg -n caliber-mis-783 --query "[].name" -o tsv | sort
```

```bash
az postgres flexible-server list --query "[?name=='coalmine-fleet-pg-783'].{resourceGroup:resourceGroup,version:version,sku:sku.name,tier:sku.tier,storageGb:storage.storageSizeGb,publicAccess:network.publicNetworkAccess}" -o table
```

Write down: the plan SKU and tier (the test plan is the same family or one size smaller), the runtime (`NODE|22-lts` expected) and startup command, the PostgreSQL major version (used as `--version` in section 4), and the list of setting names (used in section 5 to decide which non-secret general settings to mirror).

## 3. Create the test resource group, plan and web app (15 minutes)

```bash
az group create --name "$RG" --location "$LOC" --tags purpose=pulse-ii-test-platform
```

Check the app name is free world-wide (`nameAvailable: true`); otherwise choose another and remember to set `PULSE_TEST_WEBAPP_NAME` in section 6:

```bash
az rest --method post --url "https://management.azure.com/subscriptions/$SUB/providers/Microsoft.Web/checknameavailability?api-version=2023-12-01" --body "{\"name\":\"$APP\",\"type\":\"Microsoft.Web/sites\"}" --query "{available:nameAvailable,message:message}"
```

```bash
az appservice plan create --name "$PLAN" --resource-group "$RG" --location "$LOC" --is-linux --sku B2
```

B2 (2 cores, 3.5 GB) is the smallest size that comfortably loads the handwriting OCR model at start-up next to the server; B1 (1.75 GB) is too tight. If section 2 showed a Premium plan for live and you want identical behaviour under load, use the same SKU (for example `P0v3` or `P1v3`); the cost difference is in section 11.

```bash
az webapp create --name "$APP" --resource-group "$RG" --plan "$PLAN" --runtime "NODE:22-lts"
```

```bash
az webapp update --name "$APP" --resource-group "$RG" --https-only true
```

```bash
az webapp config set --name "$APP" --resource-group "$RG" --always-on true --http20-enabled true --min-tls-version 1.2 --ftps-state Disabled
```

If section 2 showed a non-empty startup command for live, copy it: `az webapp config set --name "$APP" --resource-group "$RG" --startup-file "<value>"`. With an empty one Azure runs `npm start`, which starts `server.mjs`.

```bash
az webapp show --name "$APP" --resource-group "$RG" --query "{address:defaultHostName,state:state}" -o table
```

Write down the address: Azure may assign a regional one such as `caliber-mis-test-783-<id>.centralindia-01.azurewebsites.net` instead of `caliber-mis-test-783.azurewebsites.net`. The workflow verifies whichever address the deployment reports, so either is fine.

Sharing the live plan instead (`--plan` pointing at `ASP-coalminefleetmaintenancerg-b234`) costs nothing extra but is not recommended: a test OCR run competes with the live site for CPU and memory on the same instances. If you do it anyway, create the app in `coalmine-fleet-maintenance-rg` and scope the test identity's role in section 6 to the test app resource, not to the group.

## 4. Create the test database server (15 minutes)

```bash
PG_PASSWORD="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
echo "$PG_PASSWORD"
```

Store the password in the company password manager now (entry: *Pulse-II test database, caliber_test_admin*). It is alphanumeric, so it needs no URL encoding. Use the major version from section 2 (`16` below):

```bash
az postgres flexible-server create --name "$PG" --resource-group "$RG" --location "$LOC" \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
  --admin-user "$PG_ADMIN" --admin-password "$PG_PASSWORD" \
  --public-access 0.0.0.0 --backup-retention 7 --yes
```

`--public-access 0.0.0.0` adds the firewall rule that admits Azure services, which is how the test web app reaches the server (the test plan has no VNet integration; the live set-up uses a private subnet, which is more work than a test copy needs). Connections are TLS-only; the app verifies the server certificate.

```bash
az postgres flexible-server db create --resource-group "$RG" --server-name "$PG" --database-name caliber_mis
```

Admit the laptop that will run the restore (find its public address at https://api.ipify.org; Cloud Shell has a different one):

```bash
az postgres flexible-server firewall-rule create --resource-group "$RG" --name "$PG" --rule-name owner-laptop --start-ip-address <laptop public IP> --end-ip-address <laptop public IP>
```

The test connection string, used in sections 5 and 8:

```text
postgresql://caliber_test_admin:<PG_PASSWORD>@caliber-mis-test-pg-783.postgres.database.azure.com:5432/caliber_mis
```

The test copy will hold a full copy of live operational data and password hashes. Treat the server like the live one: no further firewall rules, delete it when the trial ends (section 11).

## 5. Test app settings (10 minutes)

Cloud Shell, with `$PG_PASSWORD` still set from section 4 (otherwise paste it into the `DATABASE_URL` line by hand). The file is deleted right after use so the password does not stay in Cloud Shell storage.

```bash
HOST=$(az webapp show --name "$APP" --resource-group "$RG" --query defaultHostName -o tsv)
cat > test-app-settings.json <<EOF
[
  {"name":"DATABASE_URL","value":"postgresql://${PG_ADMIN}:${PG_PASSWORD}@${PG}.postgres.database.azure.com:5432/caliber_mis","slotSetting":false},
  {"name":"PUBLIC_APP_URL","value":"https://${HOST}","slotSetting":false},
  {"name":"PORT","value":"8080","slotSetting":false},
  {"name":"DISABLE_SCHEDULED_JOBS","value":"true","slotSetting":false},
  {"name":"META_WHATSAPP_DELIVERY_PAUSED","value":"true","slotSetting":false},
  {"name":"TELEGRAM_DELIVERY_PAUSED","value":"true","slotSetting":false},
  {"name":"VLB_BATCH_ALERTS","value":"0","slotSetting":false},
  {"name":"MIS_SSO_MODE","value":"off","slotSetting":false},
  {"name":"PULSE_WRITE_MODE","value":"off","slotSetting":false},
  {"name":"MIS_SCAN_BLOB_ENABLED","value":"false","slotSetting":false},
  {"name":"SCAN_DUPLICATE_FINGERPRINT","value":"false","slotSetting":false},
  {"name":"SCAN_DUPLICATE_CONTENT_REJECT","value":"false","slotSetting":false},
  {"name":"SCAN_DUPLICATE_SKIP_PERCENT","value":"15","slotSetting":false},
  {"name":"SCAN_DUPLICATE_SUSPECT_PERCENT","value":"30","slotSetting":false},
  {"name":"MIS_ENVIRONMENT_LABEL","value":"TEST","slotSetting":false}
]
EOF
az webapp config appsettings set --name "$APP" --resource-group "$RG" --settings @test-app-settings.json --query "[].name" -o tsv
rm test-app-settings.json
```

What each value does on the test platform:

| Setting | Test value | Why |
|---|---|---|
| `DATABASE_URL` | the test server, database `caliber_mis` | The only database the test app can reach. Live uses a Key Vault reference; the test copy keeps a plain app setting (encrypted at rest by App Service). |
| `PUBLIC_APP_URL` | the test address | Links in messages and pages point at the test site. Change it in section 9 if you add `pulse-test.cmll.in`. |
| `PORT` | `8080` | Same as live. |
| `DISABLE_SCHEDULED_JOBS` | `true` | No report schedules, reminders, WhatsApp runs, backups or audit exports from the test copy. `/api/health` must show `scheduledJobsEnabled: false`; the test workflow fails the release otherwise. |
| `META_WHATSAPP_DELIVERY_PAUSED` | `true` | WhatsApp paused. The switch saved in Report settings overrides this one, so section 8 also switches it off inside the restored copy. |
| `TELEGRAM_DELIVERY_PAUSED` | `true` | The BDMS Telegram bot is paused even if a token were ever added. |
| `VLB_BATCH_ALERTS` | `0` | The late-batch Telegram worker and the weekly alias summary run outside the scheduled-jobs switch; this stops them. |
| `MIS_SSO_MODE` | `off` | Sign-in with Pulse hands back to pulse-ll.cmll.in by design, so it cannot serve a second address. The test site uses the Pulse-II sign-in form with passwords set in section 8. |
| `PULSE_WRITE_MODE` | `off` | Express transfers and new assets are recorded locally; nothing is written to Pulse. (`off` is also the default.) |
| `MIS_SCAN_BLOB_ENABLED` | `false` | Required (rule 3). New scan images are stored in the test database. Images that live keeps in Blob storage are not visible on the test platform. |
| `SCAN_DUPLICATE_*` | live defaults | The scan-duplicate flags, visible on `/api/health`. Turn a flag on here first when a go-live plan says "test platform first". |
| `MIS_ENVIRONMENT_LABEL` | `TEST` | Every page, including sign-in, carries the yellow bar "TEST PLATFORM: not the live site. Cards saved here do not reach the live log book." and the browser tab title starts with `[TEST]`, so an operator cannot mistake the test copy for live. Live leaves the setting unset: nothing is shown there and nothing else changes. Reported as `environmentLabel` on `/api/health` and `/api/app-version`. |

**Mirror from live** (names from section 2, values from the Azure portal, none of them secrets): general runtime settings such as `SCM_DO_BUILD_DURING_DEPLOYMENT`, `WEBSITE_NODE_DEFAULT_VERSION` or `SLOW_REQUEST_THRESHOLD_MS` if live has them, and the feature flags `VLB_TWO_STAGE_BATCHES`, `EQUIPMENT_ALIAS_OTP`, `VLB_PM_APPROVAL_TRIAL`, `MIS_GEMINI_HYBRID` with the live values, so the test copy behaves like live until a trial turns one on.

**Never copy to the test app** (secrets, or settings that would reach live systems): `DATABASE_URL` from live, `MIS_DATABASE_CONNECTION_MODE`, `MIS_SCAN_BLOB_ACCOUNT`, `MIS_SCAN_BLOB_CONTAINER`, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`, `FAST2SMS_WHATSAPP_API_KEY`, `WHATSAPP_PROVIDER`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`, `TELEGRAM_BDMS_CHATBOT_ENABLED`, `TELEGRAM_BDMS_CHATBOT_PILOT_LOGINS`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `TICKET_EMAIL_TO`, `PULSE_INTEGRATION_URL`, `PULSE_INTEGRATION_TOKEN`, `GEMINI_API_KEY` and `MIS_GEMINI_API` (the workflow sets them from the optional test key), `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `QZ_SIGNING_CERTIFICATE`, `QZ_SIGNING_PRIVATE_KEY`, `TENDER_IDENTITY_KEY`, `ORACLE_DB_*`, `NEXUS_ERP_ORACLE_CONFIG`, `BDMS_AUDIT_*`, `CDIR_ROSTER_IMPORT_BROTLI_BASE64`, `MIS_INTEGRATION_KEY_FILE`. Without the mail settings `/api/health` shows `oemEmailSchedule.mailConfigured: false`; without a Telegram token the Telegram pages show "not set up". That is the intended state.

## 6. Test deployment identity and GitHub secrets (10 minutes)

Cloud Shell. The new identity can deploy to, and change settings of, apps in `caliber-mis-test-rg` only.

```bash
TEST_APP_ID=$(az ad app create --display-name github-caliber-mis-test --query appId -o tsv)
TEST_APP_OBJECT_ID=$(az ad app show --id "$TEST_APP_ID" --query id -o tsv)
TEST_SP_OBJECT_ID=$(az ad sp create --id "$TEST_APP_ID" --query id -o tsv)
az role assignment create --assignee-object-id "$TEST_SP_OBJECT_ID" --assignee-principal-type ServicePrincipal \
  --role "Website Contributor" --scope "/subscriptions/$SUB/resourceGroups/$RG"
```

```bash
cat > test-environment-credential.json <<'EOF'
{
  "name": "github-test-environment",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:caliberaitech783-beep/caliber-mis:environment:test",
  "description": "Pulse-II test platform releases from main",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
az ad app federated-credential create --id "$TEST_APP_OBJECT_ID" --parameters test-environment-credential.json
echo "AZURE_TEST_CLIENT_ID=$TEST_APP_ID"
echo "AZURE_TEST_TENANT_ID=$(az account show --query tenantId -o tsv)"
echo "AZURE_TEST_SUBSCRIPTION_ID=$SUB"
```

The subject names the GitHub environment `test`, which the test workflow references; GitHub creates that environment on the first run. Give it no protection rules.

Laptop: store the three values as repository secrets (they are identifiers, not passwords, but the workflow reads them as secrets like the live ones):

```bash
gh secret set AZURE_TEST_CLIENT_ID --repo caliberaitech783-beep/caliber-mis --body "<AZURE_TEST_CLIENT_ID printed above>"
```

```bash
gh secret set AZURE_TEST_TENANT_ID --repo caliberaitech783-beep/caliber-mis --body "<AZURE_TEST_TENANT_ID printed above>"
```

```bash
gh secret set AZURE_TEST_SUBSCRIPTION_ID --repo caliberaitech783-beep/caliber-mis --body "58ca09cf-ab5d-47a8-a438-e1fb2a40d030"
```

Optional, only if the test platform should run central Gemini extraction: create a **separate** Gemini API key for it in Google AI Studio (never reuse the live key) and store it; the workflow configures the test app with it on every release. Without this secret the step is skipped.

```bash
gh secret set MIS_TEST_GEMINI_API_KEY --repo caliberaitech783-beep/caliber-mis
```

Only if you departed from the default names in section 0:

```bash
gh variable set PULSE_TEST_WEBAPP_NAME --repo caliberaitech783-beep/caliber-mis --body "<web app name>"
```

```bash
gh variable set PULSE_TEST_RESOURCE_GROUP --repo caliberaitech783-beep/caliber-mis --body "<resource group>"
```

Cost: nothing.

## 7. First release to the test platform (20 minutes)

Merge the pull request (its `build` and `logbook-layout` checks must be green). The merge starts **Build, test and deploy to the Pulse-II test platform**. To start it by hand later:

```bash
gh workflow run "Build, test and deploy to the Pulse-II test platform" --repo caliberaitech783-beep/caliber-mis --ref main
```

```bash
gh run list --repo caliberaitech783-beep/caliber-mis --workflow "Build, test and deploy to the Pulse-II test platform" --limit 1
```

The run takes about 13 minutes. Its last step waits up to five minutes for `/api/health` on the test address to report the released commit **and** `scheduledJobsEnabled: false`, then runs the served-JavaScript check against the test address. On this first start the app creates the complete schema in the empty test database. If it stays red, watch the app:

```bash
az webapp log tail --name "$APP" --resource-group "$RG"
```

The run also appears under the repository's **Environments → test** with the test address.

## 8. Copy the live data into the test copy (30 minutes plus restore time)

### 8.1 Export a backup from live

On the live site, as Super Admin: **Full Backup → Export Backup**. Save `bdms-data-<stamp>.ndjson.gz` on an encrypted company drive. (Alternative, from a machine that can reach the live database server: `node scripts/backup-database.mjs --database-url "<live connection string>"` writes the same format into `backups/`; it needs live credentials on that machine, so prefer the Admin page.) The archive contains operational data, password hashes and stored integration credentials; never mail it or leave it on a shared drive.

### 8.2 Restore into the test database

Laptop, repository folder. The test app has run once (section 7), so the tables exist. Keep the connection string in a variable, not in the command history:

```powershell
$env:TEST_DATABASE_URL = "postgresql://caliber_test_admin:<PG_PASSWORD>@caliber-mis-test-pg-783.postgres.database.azure.com:5432/caliber_mis"
```

```powershell
node scripts/restore-database.mjs --input "C:\path\to\bdms-data-<stamp>.ndjson.gz" --database-url $env:TEST_DATABASE_URL --yes
```

The restore empties and refills every table of the backup inside one transaction and rolls back on any mismatch. A warning about tables missing in the target is expected when the backup comes from a newer build than the test app runs; they are created at the next start.

### 8.3 Prepare the copy: remove live credentials, queued messages and sessions; set a test password

A live backup carries the MIS Telegram bot and Pulse connection secrets (encrypted with the live server's key, so unreadable here but still unwanted), queued Telegram messages, the WhatsApp provider token and the stored WhatsApp delivery switch, and every live sign-in session. `scripts/prepare-test-platform-database.mjs` removes all of them in one transaction and refuses to run against `coalmine-fleet-pg-783`. Because synced users carry random MIS passwords and the test site signs in without Pulse, give your own account a test password at the same time:

```powershell
$env:TEST_LOGIN_PASSWORD = "<a test password, at least 8 characters>"
```

```powershell
node scripts/prepare-test-platform-database.mjs --database-url $env:TEST_DATABASE_URL --yes --login <your Login name from Users & employees>
```

```powershell
Remove-Item Env:TEST_LOGIN_PASSWORD
```

The script prints each table it emptied and why. Run it again after every restore.

### 8.4 Restart the test app

```bash
az webapp restart --name "$APP" --resource-group "$RG"
```

Wait two to four minutes, then open `https://<test address>/api/health`: `status: ok`, `database: connected`, `scheduledJobsEnabled: false`, `hotScanStorage.enabled: false`, `oemEmailSchedule.mailConfigured: false`, and `commit` equal to the last test release.

### 8.5 Sign in and give testers passwords

Open the test address. It shows the Pulse-II sign-in form (not Sign in with Pulse). Sign in with your Login name and the test password, open **Users & employees** and set a password for each tester (the set-password control on the user record). Password-reset OTPs do not work on the test platform, which has no WhatsApp or Telegram; set passwords here instead. Tell testers the address is the **test** site: the page looks exactly like live.

## 9. Optional: pulse-test.cmll.in (15 minutes plus DNS propagation)

Without this step the test platform is reachable at the `azurewebsites.net` address from section 3, with a valid certificate, and nothing else is needed. A custom name is easier to tell operators apart from pulse-ll.cmll.in.

```bash
az webapp show --name "$APP" --resource-group "$RG" --query "{address:defaultHostName,verificationId:customDomainVerificationId}" -o table
```

At Hostinger (DNS for cmll.in), add two records, as for `pulse-ll` in `azure-resources.json`:

| Type | Name | Value |
|---|---|---|
| CNAME | `pulse-test` | the `address` printed above |
| TXT | `asuid.pulse-test` | the `verificationId` printed above |

When `nslookup pulse-test.cmll.in` resolves, bind the name and a free managed certificate:

```bash
az webapp config hostname add --webapp-name "$APP" --resource-group "$RG" --hostname pulse-test.cmll.in
```

```bash
az webapp config ssl create --name "$APP" --resource-group "$RG" --hostname pulse-test.cmll.in
```

```bash
THUMB=$(az webapp config ssl list --resource-group "$RG" --query "[?subjectName=='pulse-test.cmll.in'].thumbprint | [0]" -o tsv)
az webapp config ssl bind --name "$APP" --resource-group "$RG" --certificate-thumbprint "$THUMB" --ssl-type SNI
```

```bash
az webapp config appsettings set --name "$APP" --resource-group "$RG" --settings PUBLIC_APP_URL=https://pulse-test.cmll.in --query "[].name" -o tsv
```

Laptop, so the workflow verifies the custom address from now on:

```bash
gh variable set PULSE_TEST_URL --repo caliberaitech783-beep/caliber-mis --body "https://pulse-test.cmll.in"
```

Cost: the managed certificate and the DNS records are free.

## 10. Checks before the team uses it (15 minutes)

1. `https://<test address>/api/health`: `commit` equals the commit of the latest run of the test workflow; `scheduledJobsEnabled: false`; `hotScanStorage.enabled: false`; `oemEmailSchedule.mailConfigured: false`; `environmentLabel: "TEST"`.
2. Telegram Integration page on the test site: not set up (no bot). Report settings: WhatsApp delivery off.
3. The ten-minute release smoke test from `docs/release-safety-plan-2026-11-02.md`, section 4 rule 3, on the test site: upload one real PDF, open the equipment review dialog, press F5, confirm the same entry, cards and card reopen, check `/api/health` and `GET /api/client-errors`.
4. Nothing arrived on live Telegram or WhatsApp while you did this. If anything did, stop the test app (`az webapp stop --name "$APP" --resource-group "$RG"`) and re-run section 8.3.
5. Merge one small change to `main` and watch it reach the test site only: `/api/health` on pulse-ll.cmll.in keeps its previous `commit`.
6. The yellow "TEST PLATFORM: not the live site" bar is visible on the sign-in page and on every page after sign-in, also on a phone, and the browser tab title starts with `[TEST]`. If it is missing, `MIS_ENVIRONMENT_LABEL` was not set in section 5. On pulse-ll.cmll.in there is no bar.

## 11. Costs and switching off

Approximate pay-as-you-go list prices for Central India, before taxes; confirm in the Azure pricing calculator before creating. The resource group is the unit of cost: everything in it can be deleted and recreated from this runbook in about an hour.

| Item | Approximate cost | Note |
|---|---|---|
| App Service plan `asp-caliber-mis-test`, B2 Linux | about US$30 per month | B1 about US$13 but too small for the OCR model; P0v3 about US$60, P1v3 about US$120 if parity with a Premium live plan is wanted. Billed while the plan exists, even when the app is stopped. |
| PostgreSQL Flexible Server B1ms, 32 GB, 7-day backups | about US$15 to US$20 per month | Billed while the server exists; `az postgres flexible-server stop` pauses compute for up to seven days. |
| Entra app registration, federated credentials, role assignment | free | |
| GitHub environments, secrets, Actions minutes | free | Public repository. |
| Managed certificate, DNS records | free | |
| Data transfer | negligible | A full restore moves a few hundred megabytes. |

Total: about US$45 to US$50 per month while the test platform exists.

Pause between trials (keeps the data, keeps most of the cost of the plan):

```bash
az webapp stop --name "$APP" --resource-group "$RG"
az postgres flexible-server stop --name "$PG" --resource-group "$RG"
```

Remove everything when a trial is over (irreversible; restore from a fresh live backup next time):

```bash
az group delete --name "$RG" --yes --no-wait
```

The GitHub secrets, variables, environment `test` and the identity `github-caliber-mis-test` can stay; they cost nothing and are harmless without the resource group. Deleting the group does not touch `coalmine-fleet-maintenance-rg`.

## 12. What this runbook never touches

- **Production app settings.** No command names `caliber-mis-783` except the read-only `show` and `list` commands in section 2, which print names and runtime facts, never values. The test workflow refuses to deploy to `caliber-mis-783` or to verify `pulse-ll.cmll.in` even if a repository variable says so.
- **The production database.** `coalmine-fleet-pg-783` appears only in the read-only `list` in section 2. The restore target is always the test server; `scripts/prepare-test-platform-database.mjs` refuses the live server by name. The live database is read only through the Admin page export.
- **Production secrets.** None is copied. The test identity holds a role in `caliber-mis-test-rg` only. The live identity gets one additional sign-in rule (section 1.2) and nothing else.
- **Operators' phones and chats.** No Telegram, WhatsApp or mail credential exists on the test app; the stored ones are removed from the copy; scheduled jobs, the late-batch worker and WhatsApp delivery are switched off and `/api/health` proves it on every release.
- **Pulse.** The test copy cannot read Pulse masters (its stored connection is removed) and never writes to Pulse (`PULSE_WRITE_MODE=off`). Masters on the test platform are those of the backup.

## 13. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Test workflow fails at *Login to Azure* with `AADSTS70021: No matching federated identity record found` | The federated credential subject does not match. It must be exactly `repo:caliberaitech783-beep/caliber-mis:environment:test` (section 6). |
| Production workflow fails at *Confirm the production environment still requires a reviewer* | Section 1.1 was not done or the rule was removed. Add the required reviewer and start the release again. |
| Production workflow fails at *Login to Azure* with `AADSTS70021` | Section 1.2 was not done: the live identity lacks the `environment:production` credential. |
| Production run is refused with *not allowed to deploy to production due to environment protection rules* | The ref is not a `release-*` tag or `main`. Tag the commit as in `docs/release-safety-plan-2026-11-02.md`, section 6. |
| *Commit … is not on main* | The tag points at a commit that never reached `main` (so the test platform never served it). Tag the commit shown by `/api/health` on the test site instead. |
| App log: `Shared MIS administration requires the approved Azure database server` | `MIS_DATABASE_CONNECTION_MODE` was copied. Delete that setting on the test app (rule 2). |
| App log: `MIS must connect only to the caliber_mis database` | The database in `DATABASE_URL` is not named `caliber_mis` (rule 1). |
| App log: `Scan Blob storage is limited to Pulse-II` | `MIS_SCAN_BLOB_ENABLED` is `true` on the test app (rule 3). |
| `/api/health` is 503 `degraded` | `DATABASE_URL` wrong, or the firewall rule for Azure services is missing (section 4). `az postgres flexible-server firewall-rule list --resource-group "$RG" --name "$PG" -o table` must show the `0.0.0.0` rule. |
| Restore prints *Tables missing in the target database were skipped* | Normal if the backup is newer than the deployed build. Release to the test platform, then restore again if those tables matter. |
| Restore cannot connect from the laptop | The laptop's public address changed; update the `owner-laptop` firewall rule (section 4). |
| Nobody can sign in on the test site | Synced users have random MIS passwords. Run section 8.3 with `--login` for your account, then set passwords for testers in Users & employees. |
| Telegram Integration page shows "temporarily unavailable" | Section 8.3 was not run after a restore; the stored bot secret cannot be decrypted on the test app. Run it and restart. |
| A test release shows up on live, or vice versa | Impossible by construction (separate identities, separate concurrency groups, hard-coded refusals), so first confirm which `/api/health` you are reading. |

## 14. Record the result

1. Replace the `testPlatform` block in `azure-resources.json` with the final names and address (status `configured`).
2. Add the test address and the rule "main is the test platform; a `release-*` tag plus approval is live" to the team's pinned WhatsApp message.
3. Keep the password manager entries: *Pulse-II test database* and, if created, *Pulse-II test Gemini key*.
4. Every future "test platform first" go-live plan (`docs/vlb-elb-batch.md` section 10, `docs/scan-duplicate-go-live-plan-2026-11-02.md`) now has a platform to run on: turn the flag on in the test app's settings (section 5), restore a fresh backup when real recent data matters, and follow `docs/release-safety-plan-2026-11-02.md` section 6 to release.
