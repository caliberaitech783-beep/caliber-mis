# Pulse-II MIS administration and support

The MIS sidebar has exactly five Admin entries: User Sessions, Print helper,
Full Backup, Audit Trail and Database. Tickets and Telegram Integration are
separate working menus available to MIS users.

## Permissions

Separate MIS credentials carry a generic `Admin` label, which does not grant
these administrative functions. The trusted identity issuer's **Login Details**
(`Users & employees`) permission identifies an MIS administrator. Both the
browser and backend check this capability. Existing account assignments are not
changed. Existing non-MIS administrator authentication is retained.

User Sessions and Audit Trail provide inspection, history and report exports.
MIS does not expose the existing session force-close, log deletion, automatic
clean-up or database restore controls. Database shows the local MIS database
connection and active log-book/scan counts.

## Backups

Full Backup creates a stored, checksummed database recovery file and provides
authenticated downloads. It does not invoke backup pruning. The recovery file
contains all database tables, including scan references; original Blob images
are separate. The page links to the existing verified scanned-card SSD backup
workflow. Keep the protected integration encryption key separately for recovery
of encrypted integration settings. This feature does not change retention or
start a backup automatically.

## Tickets

Users can create and track their own tickets, including attachments and audio.
MIS enforces assigned sites on submission; users without an assignment can file
a ticket under `Not assigned`. Entry-only accounts cannot resolve tickets or
open another user's ticket/media. Authorized MIS admins can resolve tickets.
Resolution notices and acknowledgement remain in the application. MIS ticket
events do not trigger Pulse's legacy WhatsApp or email fan-out.

## Telegram setup

1. Open `https://pulse-ll.cmll.in/?page=telegram` as an MIS admin.
2. Create a dedicated MIS bot using Telegram BotFather. A bot whose webhook is
   assigned to another application is rejected rather than taking it over.
3. Enter its token in the password field, enable notifications, and save. The
   token is persisted in the existing AES-GCM integration secret store and is
   never returned in status responses, browser storage, or audit payloads.
4. Choose **Connect my Telegram**, open the generated link and press Start in
   Telegram. The link expires after 10 minutes and can be consumed only once
   from an authenticated private Telegram chat.
5. To receive admin ticket alerts privately, copy the chat ID shown on your
   connected account into Admin chat ID and save. Alternatively enter the MIS
   admin group's chat ID after adding the bot there. Send a test message using
   the explicit button.

Ticket-created alerts go to the configured admin chat. Resolution alerts also
go to the creator's linked private chat. Delivery uses a durable outbox, batches
of at most five, authenticated webhooks and retry backoff (five attempts).
The integration stays inactive until an admin supplies and enables a bot.

The webhook is fixed to `https://pulse-ll.cmll.in/api/mis-telegram/webhook` and
uses Telegram's secret-token header. No Pulse-I configuration is changed.
