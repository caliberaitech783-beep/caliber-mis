# Private test copy for the VLB + ELB rebuild

Date: 3 November 2026. Branch: `revise/vlb-elb`. Owner: Mohit (the only user).

This is a Pulse-II copy that only the owner can open. It is separate from production and from the shared test platform (`caliber-mis-test-783`, `docs/test-platform-setup.md`). Other people building their own test copies use their own app, database and workflow. Nothing in this guide touches theirs.

## 1. How access works

1. Any page of the copy opens the **private gate** instead of the app.
2. You type the **gate password**. It is in `.env.private-test.local` in the revise worktree, line `PRIVATE_GATE_PASSWORD`. That file is ignored by git and never leaves your PC. Store the password in your password manager, then you may delete the line.
3. The server sends a **6-digit code by Telegram to your chat only**. Valid 10 minutes, 5 tries, one code per minute.
4. You type the code. The browser gets a signed cookie for 12 hours. After that, or after `/__private-gate/logout`, you pass the gate again.

Nobody else can pass: the password alone is not enough, because the code goes only to your Telegram. After the gate, the normal Pulse-II sign-in still applies.

Only `/api/health` stays open, so the deploy can confirm the commit. It shows no data.

| Protection | Value |
|---|---|
| Wrong passwords | 5 per address, 20 in total, per 15 minutes |
| Code validity | 10 minutes, single use, 5 tries |
| Codes sent | one per minute |
| Session | 12 hours, HttpOnly cookie, signed with `PRIVATE_GATE_SECRET` and the password hash |
| Changing the password | Ends every open session at once |
| Gate on but a setting missing | Every page answers 503; the copy never opens unprotected |

## 2. Why a separate Telegram bot

A copy of Pulse-II that starts with the live bot settings (`TELEGRAM_BOT_TOKEN`) registers its own address as the bot's webhook and takes the bot away from production. So:

- The gate uses its own variable, `PRIVATE_GATE_TELEGRAM_BOT_TOKEN`.
- With `PRIVATE_GATE=on` the server never registers a webhook, even if a live token is present.
- The deploy deletes `TELEGRAM_BOT_TOKEN` and `TELEGRAM_DEFAULT_CHAT_ID` from the private app.

**Recommended: create a new bot for the gate** so no production token is copied:

1. In Telegram, open `@BotFather`, send `/newbot`, name it for example *Pulse private gate*. Copy the token it gives you.
2. Open your new bot and press **Start**. A bot cannot message you until you do.
3. In a browser, open `https://api.telegram.org/bot<token>/getUpdates`. Your chat id is the number at `"chat":{"id":...}`.

## 3. Names

All names are new; none is shared with production or the shared test platform. Check the app and database names are free (runbook section 3) and pick others if not.

| Item | Name |
|---|---|
| Resource group | `pulse-private-mohit-rg` |
| App Service plan | `pulse-private-mohit-plan` (B2) |
| Web app | `pulse-mohit-revise-783` |
| PostgreSQL server | `pulse-mohit-revise-pg-783` (Burstable B1ms) |
| Deploy identity | `pulse-private-mohit-deployer`, Website Contributor on the resource group only |
| GitHub environment | `private-test-owner`, you as the only required reviewer |
| Workflow | `.github/workflows/private-test-revise.yml`, runs only for pushes to `revise/vlb-elb` |

## 4. Set-up (about 1.5 hours, all by the owner)

**Shortcut:** steps 1–8 below are automated by one script, run from the revise worktree on a PC where `az` and `gh` are signed in:

```powershell
pwsh scripts/setup-private-test-copy.ps1 -Subscription <subscription id> -BotToken <gate bot token> -ChatId <your chat id>
```

It refuses production and shared-test names, keeps existing resources on a re-run, writes the database address into `.env.private-test.local`, and sets `PRIVATE_TEST_WEBAPP_NAME` only when the bot token and chat id are given. Then do steps 9 and 10.

Manual route: run in Azure Cloud Shell. Each step is the shared runbook's step with the private names above.

1. **Variables:** `RG=pulse-private-mohit-rg`, `PLAN=pulse-private-mohit-plan`, `APP=pulse-mohit-revise-783`, `PG=pulse-mohit-revise-pg-783`, `PG_ADMIN=private_admin`, `LOC=centralindia`.
2. **Resource group, plan, web app:** runbook section 3, with these names. Tag the group `purpose=pulse-private-owner-test`.
3. **Database:** runbook section 4. Store the database password in your password manager.
4. **App settings:** runbook section 5, with three changes: `MIS_ENVIRONMENT_LABEL=PRIVATE TEST`; never add `TELEGRAM_BOT_TOKEN`; add nothing that starts with `PRIVATE_GATE_` by hand, because the workflow writes those from GitHub secrets on every deploy.
5. **Deploy identity:** runbook section 6 with the private names. The federated credential subject must use this repository's immutable form:

   ```text
   repo:caliberaitech783-beep@313449839/caliber-mis@1425843232:environment:private-test-owner
   ```

6. **GitHub environment `private-test-owner`:** Settings, Environments, New environment. Required reviewers: you only. Deployment branches: `revise/vlb-elb` only.
7. **Secrets in that environment:**

   | Secret | Value |
   |---|---|
   | `AZURE_PRIVATE_CLIENT_ID`, `AZURE_PRIVATE_TENANT_ID`, `AZURE_PRIVATE_SUBSCRIPTION_ID` | From step 5 |
   | `PRIVATE_GATE_PASSWORD_HASH` | Line `PRIVATE_GATE_PASSWORD_HASH` of `.env.private-test.local` |
   | `PRIVATE_GATE_SECRET` | Line `PRIVATE_GATE_SECRET` of `.env.private-test.local` |
   | `PRIVATE_GATE_TELEGRAM_BOT_TOKEN` | The new bot token from section 2 |
   | `PRIVATE_GATE_TELEGRAM_CHAT_ID` | Your chat id from section 2 |

8. **Repository variables:** `PRIVATE_TEST_WEBAPP_NAME=pulse-mohit-revise-783`, `PRIVATE_TEST_RESOURCE_GROUP=pulse-private-mohit-rg`. Optional `PRIVATE_TEST_URL` if you add a custom address. Until `PRIVATE_TEST_WEBAPP_NAME` is set, the workflow is skipped, not failed.
9. **First deploy:** Actions, *Deploy revise/vlb-elb to the owner's private test copy*, Run workflow on `revise/vlb-elb`. Approve it. The last step fails the run if the home page is not behind the gate or the API answers without it.
10. **Data:** runbook section 8 restores a live backup into the private database and removes live credentials and sessions. Run `scripts/prepare-test-platform-database.mjs` with `--login <your login>` so you can sign in after the gate.

## 5. Make a new password

```powershell
node scripts/private-gate-password.mjs --write .env.private-test.local
```

Copy the new `PRIVATE_GATE_PASSWORD_HASH` and `PRIVATE_GATE_SECRET` into the GitHub secrets and re-run the workflow. Every open session ends.

## 6. Start today on your PC, before Azure

The local copy is private by design: it listens on `127.0.0.1` only, so no one else on the network can reach it, and it uses its own database under `%LOCALAPPDATA%\CaliberERP`. It does not need the gate.

```powershell
npm.cmd run local:backend
```

```powershell
npm.cmd run local:ui
```

Open `http://127.0.0.1:4174/`. Details are in `ERP-LOCAL.md`.

## 7. Switch off

```bash
az group delete --name pulse-private-mohit-rg --yes
```

This deletes the private app and its database only. Delete the GitHub environment `private-test-owner` too.
