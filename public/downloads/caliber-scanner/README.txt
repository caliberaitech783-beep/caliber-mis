CALIBER LOCAL SCANNER CONNECTOR 1.0.1
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

After restarting Windows: double-click the Caliber Scanner Desktop or Start Menu shortcut.
The connector starts in the background. It does not install a service or start automatically at sign-in.
It listens only on 127.0.0.1:4174. If an older local MIS connector is already using that port, this package
will not replace the running process. Close that connector before starting this standalone version.

Direct scans: single-sided, up to 120 pages. For duplex or existing PDFs, use your scanner software and
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

VERSION 1.0.1 — SMALL SCAN UPLOADS
Pages are converted to grayscale JPEG before upload, targeting 200–500 KB, with a 500 KB ceiling.
Simple pages may be smaller than 200 KB. The connector keeps the highest quality that fits and does
not reduce the longest edge below 1600 pixels. If a complex page cannot fit, it retains the original
and asks you to use Upload files. Originals are retained unchanged; compressed -upload.jpg copies
are stored alongside them. The scanner window displays the upload size in KB.
When upgrading from 1.0.0: finish scanning, install this version, restart Windows, then double-click
the updated Caliber Scanner shortcut. Reinstalling does not replace an already-running old process.
