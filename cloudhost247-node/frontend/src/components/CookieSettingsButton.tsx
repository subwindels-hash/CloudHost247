import { marketingEngine } from '../lib/marketing';

/** The shared preference centre is the same on React, active Smarty and legacy Smarty. */
export default function CookieSettingsButton() {
  return <button type="button" className="ch247-cookie-settings" data-cookie-settings onClick={() => marketingEngine().openPreferences()}>Cookie settings</button>;
}
