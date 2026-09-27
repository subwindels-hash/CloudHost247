================================================================================
  WHMCS DNS Checker Addon Module - Installation Guide
================================================================================

MODULE OVERVIEW
--------------------------------------------------------------------------------
Name:        DNS Checker
Version:     1.0
Compatible:  WHMCS 8.9.x | PHP 5.6 - 7.4 | IonCube 10.x - 11.x
License:     Free to use and modify for your WHMCS installation

This module provides a DNS propagation checker inside your WHMCS client area,
similar to tdnschecker.org. Clients can query A, MX, NS, TXT, and CNAME
records against multiple global DNS servers in real-time.


FOLDER STRUCTURE
--------------------------------------------------------------------------------
/modules/addons/dnschecker/
    dnschecker.php              Main module file (config, logic, handlers)
    hooks.php                   Hook file (safe, minimal - optional)
    /templates/
        clientarea.tpl          Client area UI template (form + AJAX + results)


INSTALLATION STEPS
--------------------------------------------------------------------------------

1. UPLOAD FILES
   Copy the entire /modules/addons/dnschecker/ folder into your WHMCS
   installation at:

       /WHMCS_ROOT/modules/addons/dnschecker/

   Ensure the folder and file permissions are correct (typically 755 for
   folders, 644 for files).

2. ACTIVATE THE MODULE
   - Log in to your WHMCS Admin area.
   - Navigate to: System Settings > Addon Modules (or Setup > Addon Modules
     in older WHMCS versions).
   - Find "DNS Checker" in the list and click "Activate".

3. CONFIGURE RECORD TYPES
   - After activation, click "Configure" next to DNS Checker.
   - Select which DNS record types you want checked by default:
       * A, MX, NS, TXT, CNAME (all - recommended)
       * A, MX, NS, TXT
       * A, MX, NS
       * A, MX
       * A only, MX only, NS only, TXT only, CNAME only
   - Save changes.

4. ACCESS THE CHECKER (ADMIN)
   - In the Addon Modules list, click "Manage" or the module name.
   - View server capability status and the client access URL.

5. ACCESS THE CHECKER (CLIENT AREA)
   - Direct URL: https://yourdomain.com/index.php?m=dnschecker
   - You can add this link to your client area navigation menu, header,
     or knowledgebase for easy access.


FEATURES
--------------------------------------------------------------------------------
- Domain input validation (sanitizes URLs, www prefixes, ports, paths)
- IDN / Unicode domain support (if intl extension is available)
- AJAX-based checking (no full page reload)
- Loading spinner animation while querying
- Responsive table results inside WHMCS client area theme
- Propagation status badges (Propagated / Not Found)
- Multiple global DNS servers queried:
    * System Default (local resolver)
    * Google DNS (8.8.8.8)
    * Cloudflare (1.1.1.1)
    * Quad9 (9.9.9.9)
    * OpenDNS (208.67.222.222)
    * Level3 (209.244.0.3)


TECHNICAL NOTES
--------------------------------------------------------------------------------
- The module first attempts to use "dig" for querying specific nameservers.
- If "dig" is unavailable, it falls back to "nslookup".
- If shell commands are disabled, it falls back to PHP's dns_get_record()
  (local resolver only). In this case, all servers may show identical results.
- The admin area shows a capability report so you know which mode is active.
- No external APIs, libraries, or Composer dependencies are used.
- All functions are prefixed with "dnschecker_" to avoid naming collisions.
- PHP files intentionally omit the closing "?>" tag to prevent accidental
  whitespace output.


TROUBLESHOOTING
--------------------------------------------------------------------------------

Q: All DNS servers show identical results.
A: Your server has shell_exec disabled. The module is using PHP's local DNS
   resolver. This is normal on shared hosting. Results are still accurate for
   the local resolver.

Q: "DNS lookup functions are not available" error.
A: Both shell_exec AND dns_get_record are disabled on your server. Contact
   your host to enable one of these, or move to a VPS/dedicated server.

Q: Records show "Not Found" for a valid domain.
A: Some public DNS servers may rate-limit queries. The module sets a 5-second
   timeout. Try again, or check the specific server directly.

Q: Module causes a blank page or error.
A: Ensure you uploaded ALL files including the templates/ folder. Check your
   PHP error logs for specific issues. The module uses only standard WHMCS
   functions and PHP 5.6+ features.

Q: Can I add more DNS servers?
A: Yes. Edit dnschecker.php and modify the dnschecker_get_dns_servers()
   function to add or remove servers.


CUSTOMIZATION
--------------------------------------------------------------------------------

- To require login: Edit clientarea.tpl or dnschecker.php and change
  'requirelogin' from false to true.

- To add a sidebar link: Uncomment the example hook in hooks.php.

- To change styling: Edit the <style> block in templates/clientarea.tpl.

- To add more record types: Modify the 'fields' array in dnschecker_config()
  and update the switch statements in dnschecker_get_records_local().


SECURITY
--------------------------------------------------------------------------------
- All user input is sanitized via escapeshellarg() and regex validation.
- Domain names are stripped of protocols, paths, ports, and www prefixes.
- The module does not store any client data or query logs by default.
- No direct file access is possible due to the defined("WHMCS") guard.


SUPPORT
--------------------------------------------------------------------------------
This module is provided as-is for integration into your WHMCS project.
For advanced customizations, consult a WHMCS developer or modify the
source code following WHMCS coding standards.

================================================================================
End of README
================================================================================
