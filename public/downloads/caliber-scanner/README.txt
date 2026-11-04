CALIBER LOCAL SCANNER CONNECTOR 1.0.6
Windows 10/11, 64-bit (x64). Includes Node.js 22.23.4; see Node-LICENSE.txt.

1. Extract the entire ZIP into a folder on your PC.
2. Double-click Install-Caliber-Scanner.cmd. Review the install location and type YES.
3. Install the official Windows WIA driver for your scanner if needed:
   Brother ADS-3100: https://support.brother.com/g/b/downloadtop.aspx?c=us&lang=en&prod=ads3100_us_as_cn
   Canon DR-C225II: https://in.canon/en/support/0100992018?model=DR-C225__+C225W
4. Power on the scanner and connect it by USB to this PC.
5. Open https://pulse-ll.cmll.in and sign in. Open VLB/ELB scanning, then Connect PC scanner.
6. Allow local network access and the scanner popup if your browser prompts.
7. The detected Brother ADS-3100 or Canon DR-C225II is selected. If both are connected, choose one.
8. Load the feeder and click Scan and send to online MIS.

After restarting Windows: sign in to the Windows account used during installation.
The connector starts automatically and silently using its Windows Startup shortcut.
You do not need to reinstall it or open the Desktop shortcut after each restart.
It does not install a system service. Each Windows user that scans installs it once.
It listens only on 127.0.0.1:4174. If an older local MIS connector is already using that port, this package
will not replace the running process. Close that connector before starting this standalone version.

Direct scans: single-sided, up to 40 cards. For duplex or existing PDFs, use your scanner software and
the online MIS Upload files tab. The standalone connector does not import saved PDFs or run local OCR.
Gemini extraction and normal validation/saving happen in your existing online MIS account.

Scan images are retained under %LOCALAPPDATA%\CaliberScanner\scans. No automatic deletion is performed.
Retry sending works while the connector and authorized scanner window remain open. After restarting,
retained PNG images can be uploaded using online MIS Upload files.

No MIS passwords, API keys, database copies, scanner drivers or private company data are included.
Driver installation may need Windows administrator approval. The connector itself installs per-user.
Windows WIA and .NET Framework 4.x must be available (included with supported Windows versions).
The scanner helper does not depend on PowerShell script execution being enabled.
This package is not digitally code-signed. Follow your organization's software approval process;
the installer does not change execution policy or Windows security settings.

VERSION 1.0.5 — SMALL SCAN UPLOADS
Pages are converted to grayscale JPEG before upload, targeting 200–500 KB, with a 500 KB ceiling.
Simple pages may be smaller than 200 KB. The connector keeps the highest quality that fits and does
not reduce the longest edge below 1600 pixels. If a complex page cannot fit, it retains the original
and asks you to use Upload files. Originals are retained unchanged; compressed -upload.jpg copies
are stored alongside them. The scanner window displays the upload size in KB.
When upgrading: finish scanning, install this version, restart Windows once, then sign in.
The updated connector starts automatically. Installation does not replace a running old process.

VERSION 1.0.5 — CANON USB DETECTION AND INSTALLER REPAIR
Recognizes CANON DR-C225 USB and numbered Windows copies such as CANON DR-C225 USB #2.
Fixes the fresh-install folder-copy error. After updating, restart Windows once and sign in.

VERSION 1.0.5 — BROTHER DRIVER NAME DETECTION
Recognizes ADS-3100 and ADS-3100 USB even when Windows omits the Brother manufacturer name.
Install this update on the PC physically connected to the scanner. Finish any scan first.
If an older connector is still running, restart Windows once and sign in,
then use Connect PC scanner in online MIS. The installer does not replace a running process.
If the list is still empty, test Windows Scan or Brother ScanEssentials on that PC.
If Windows cannot detect the scanner, install the official Brother Full Driver & Software Package
for ADS-3100 and select USB. Scanner drivers are not included in this connector.

VERSION 1.0.5 — AUTOMATIC STARTUP AFTER WINDOWS RESTARTS
The installer creates or updates this Windows user's startup entry:
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Caliber Scanner.lnk
It points to the installed launcher under %LOCALAPPDATA%\CaliberScanner\versions.
The extracted download folder is not used at startup. Opening the Desktop shortcut again
reuses an already-running connector instead of starting another instance.
If Windows Startup Apps or company policy disables this entry, enable Caliber Scanner
there or contact your Windows administrator. The Desktop shortcut remains a manual fallback.

VERSION 1.0.5 — INTEGRATED MIS SCANNER SETUP
MIS checks the connector at login and displays live connector and scanner status in VLB and ELB.
Select Install Scanner Connector inside MIS for a download progress indicator. Extract the ZIP,
run Install-Caliber-Scanner.cmd and type YES once. Windows installation cannot run silently from a website.
Setup displays five actual stages: file copying, launcher creation, automatic startup registration,
connector health verification, and completion. MIS verifies the connector and shows supported scanners.
Scanner names are sent only through the MIS-authorized status bridge using a one-time connection ticket.
If the browser blocks local-network access, allow it and retry. An unreachable connector does not
necessarily mean it is uninstalled. Driver or USB problems are shown separately from installation.

VERSION 1.0.6 — 40-CARD SCAN ENTRIES
Each feeder scan stops at 40 cards. Scan the remaining cards in another entry.
Create Batch in MIS combines all saved entries for the same date, location and shift.
The final shift batch can contain more than 40 cards.
Finish scanning and restart Windows after installation to activate this update.
