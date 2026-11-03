# Creates the owner's private Pulse-II test copy (docs/private-test-copy.md) in one run.
#
#   pwsh scripts/setup-private-test-copy.ps1 -Subscription <id> -BotToken <gate bot token> -ChatId <your chat id>
#
# Needs: az signed in with rights to create resources and app registrations in that
# subscription; gh signed in to caliberaitech783-beep with repo rights; run from the
# revise/vlb-elb worktree (it reads .env.private-test.local for the gate hash and secret).
# Safe to re-run: existing resources are kept, settings and secrets are rewritten.
# Never touches production (caliber-mis-783) or the shared test platform (caliber-mis-test-783).
param(
  [Parameter(Mandatory)] [string] $Subscription,
  [string] $BotToken = '',
  [string] $ChatId = '',
  [string] $Location = 'centralindia',
  [string] $ResourceGroup = 'pulse-private-mohit-rg',
  [string] $Plan = 'pulse-private-mohit-plan',
  [string] $App = 'pulse-mohit-revise-783',
  [string] $PgServer = 'pulse-mohit-revise-pg-783',
  [string] $PgAdmin = 'private_admin',
  [string] $Identity = 'pulse-private-mohit-deployer',
  [string] $Repo = 'caliberaitech783-beep/caliber-mis',
  [string] $Environment = 'private-test-owner'
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if ($App -in @('caliber-mis-783', 'caliber-mis-test-783')) { throw 'Refusing: that app name belongs to production or the shared test platform.' }
$envFile = Join-Path (Get-Location) '.env.private-test.local'
if (-not (Test-Path $envFile)) { throw 'Run from the revise worktree: .env.private-test.local not found. Create it with node scripts/private-gate-password.mjs --write .env.private-test.local' }
$local = @{}
Get-Content $envFile | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $i = $_.IndexOf('='); $local[$_.Substring(0, $i)] = $_.Substring($i + 1) }

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

Step 'Subscription'
az account set --subscription $Subscription
$tenant = az account show --query tenantId -o tsv
foreach ($ns in 'Microsoft.Web', 'Microsoft.DBforPostgreSQL') {
  if ((az provider show -n $ns --query registrationState -o tsv) -ne 'Registered') { az provider register -n $ns --wait | Out-Null }
}

Step 'Resource group, plan, web app'
az group create --name $ResourceGroup --location $Location --tags purpose=pulse-private-owner-test --output none
if (-not (az appservice plan list -g $ResourceGroup --query "[?name=='$Plan'].name" -o tsv)) {
  az appservice plan create --name $Plan --resource-group $ResourceGroup --location $Location --is-linux --sku B2 --output none
}
if (-not (az webapp list -g $ResourceGroup --query "[?name=='$App'].name" -o tsv)) {
  az webapp create --name $App --resource-group $ResourceGroup --plan $Plan --runtime 'NODE:22-lts' --output none
}
az webapp update --name $App --resource-group $ResourceGroup --https-only true --output none
az webapp config set --name $App --resource-group $ResourceGroup --always-on true --http20-enabled true --min-tls-version 1.2 --ftps-state Disabled --output none
$hostName = az webapp show --name $App --resource-group $ResourceGroup --query defaultHostName -o tsv

Step 'PostgreSQL server and database'
$pgSettingsKnown = $local.ContainsKey('PRIVATE_DATABASE_URL')
if (-not (az postgres flexible-server list -g $ResourceGroup --query "[?name=='$PgServer'].name" -o tsv)) {
  $bytes = New-Object byte[] 24; [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $pgPassword = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '').Substring(0, 28)
  az postgres flexible-server create --name $PgServer --resource-group $ResourceGroup --location $Location `
    --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 `
    --admin-user $PgAdmin --admin-password $pgPassword --public-access 0.0.0.0 --backup-retention 7 --yes --output none
  az postgres flexible-server db create --resource-group $ResourceGroup --server-name $PgServer --database-name caliber_mis --output none
  $databaseUrl = "postgresql://${PgAdmin}:${pgPassword}@${PgServer}.postgres.database.azure.com:5432/caliber_mis"
  Add-Content -Path $envFile -Value "PRIVATE_DATABASE_URL=$databaseUrl"
  Write-Host 'Database password saved to .env.private-test.local (PRIVATE_DATABASE_URL). Copy it to your password manager.'
} elseif ($pgSettingsKnown) {
  $databaseUrl = $local['PRIVATE_DATABASE_URL']
} else {
  throw "Server $PgServer exists but PRIVATE_DATABASE_URL is not in .env.private-test.local. Reset its admin password in the portal and add the line."
}

Step 'App settings (no live credentials; gate settings come from the workflow)'
$settings = @(
  "DATABASE_URL=$databaseUrl", "PUBLIC_APP_URL=https://$hostName", 'PORT=8080',
  'DISABLE_SCHEDULED_JOBS=true', 'META_WHATSAPP_DELIVERY_PAUSED=true', 'TELEGRAM_DELIVERY_PAUSED=true',
  'VLB_BATCH_ALERTS=0', 'MIS_SSO_MODE=off', 'PULSE_WRITE_MODE=off', 'MIS_SCAN_BLOB_ENABLED=false',
  'SCAN_DUPLICATE_FINGERPRINT=false', 'SCAN_DUPLICATE_CONTENT_REJECT=false',
  'MIS_ENVIRONMENT_LABEL=PRIVATE TEST', 'PRIVATE_GATE=on', 'VLB_V2=on'
)
az webapp config appsettings set --name $App --resource-group $ResourceGroup --settings @settings --output none

Step 'Deploy identity (Website Contributor on this resource group only)'
$appId = az ad app list --display-name $Identity --query '[0].appId' -o tsv
if (-not $appId) { $appId = az ad app create --display-name $Identity --query appId -o tsv }
if (-not (az ad sp list --filter "appId eq '$appId'" --query '[0].id' -o tsv)) { az ad sp create --id $appId --output none }
$subject = "repo:caliberaitech783-beep@313449839/caliber-mis@1425843232:environment:$Environment"
if (-not (az ad app federated-credential list --id $appId --query "[?subject=='$subject'].name" -o tsv)) {
  $credential = @{ name = 'github-private-test-owner'; issuer = 'https://token.actions.githubusercontent.com'; subject = $subject; audiences = @('api://AzureADTokenExchange') } | ConvertTo-Json -Compress
  $credFile = New-TemporaryFile; Set-Content -Path $credFile -Value $credential
  az ad app federated-credential create --id $appId --parameters "@$credFile" --output none
  Remove-Item $credFile
}
$scope = az group show --name $ResourceGroup --query id -o tsv
if (-not (az role assignment list --assignee $appId --scope $scope --role 'Website Contributor' --query '[0].id' -o tsv)) {
  az role assignment create --assignee $appId --role 'Website Contributor' --scope $scope --output none
}

Step 'GitHub secrets and variables'
function Set-EnvSecret($name, $value) { if ($value) { gh secret set $name --env $Environment --repo $Repo --body $value } }
Set-EnvSecret 'AZURE_PRIVATE_CLIENT_ID' $appId
Set-EnvSecret 'AZURE_PRIVATE_TENANT_ID' $tenant
Set-EnvSecret 'AZURE_PRIVATE_SUBSCRIPTION_ID' $Subscription
Set-EnvSecret 'PRIVATE_GATE_PASSWORD_HASH' $local['PRIVATE_GATE_PASSWORD_HASH']
Set-EnvSecret 'PRIVATE_GATE_SECRET' $local['PRIVATE_GATE_SECRET']
Set-EnvSecret 'PRIVATE_GATE_TELEGRAM_BOT_TOKEN' $BotToken
Set-EnvSecret 'PRIVATE_GATE_TELEGRAM_CHAT_ID' $ChatId
gh variable set PRIVATE_TEST_RESOURCE_GROUP --body $ResourceGroup --repo $Repo
if ($BotToken -and $ChatId) {
  gh variable set PRIVATE_TEST_WEBAPP_NAME --body $App --repo $Repo
  Write-Host "`nDone. Run the workflow: gh workflow run private-test-revise.yml --ref revise/vlb-elb --repo $Repo, then approve it in Actions."
} else {
  Write-Host "`nAzure is ready. Telegram bot token or chat id missing, so PRIVATE_TEST_WEBAPP_NAME was not set and deploys stay skipped."
  Write-Host 'Re-run this script with -BotToken and -ChatId when you have them (docs/private-test-copy.md, section 2).'
}
Write-Host "Private address: https://$hostName"
