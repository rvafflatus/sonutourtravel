# Apps Script setup

The admin page keeps no password in the public site. This Apps Script handler validates the password against a server-side Script Property, issues a short-lived session token, and checks that token on each data request.

1. In the Apps Script project connected to the travel spreadsheet, add the contents of `Code.gs`.
2. In **Project Settings → Script properties**, add:
   - `ADMIN_PASSWORD`: a unique, long random password. Do not put it in this repository or in `admin.html`.
   - `SPREADSHEET_ID`: the spreadsheet ID, unless this is a script bound directly to the target spreadsheet.
3. Ensure the spreadsheet has a `Sheet1` tab with `Name` and `HSN` headers, and an `Invoices` tab with the exact 26 headers defined in `Code.gs`. An empty tab is initialized automatically; a non-empty tab with different headers is rejected.
4. Deploy as a **Web app**, choose **Execute as me**, and set access to **Anyone**. The endpoint must be publicly reachable because the static GitHub Pages site cannot supply a Google sign-in session. The script still requires a server-validated password and session token for invoice and HSN data.
5. Copy the deployed `/exec` URL into `window.SONUTOUR_ADMIN_CONFIG.apiUrl` in `admin.html` if it differs from the configured URL.

The endpoint URL is public configuration, not a secret. The password, spreadsheet ID, and session token must not be added to public source files. Apps Script deployment access settings may be restricted by your Google Workspace administrator.
