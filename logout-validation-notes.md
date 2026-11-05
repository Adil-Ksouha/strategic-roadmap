# Logout Validation Notes

The authenticated Northstar sidebar now shows a distinct **Log out** button beneath the active user profile. The browser interaction dispatched the logout action; subsequent page rendering must be verified through the `auth.me` response because the development preview can temporarily retain an auto-login mirror while its portfolio content finishes loading.

The direct `auth.me` check still returned an authenticated user after two logout-control selections. The backend logout mutation or preview session path therefore requires further diagnosis before this control can be considered fully validated.

The logout implementation now clears the preview bearer-token mirror before navigating to a dedicated `/api/auth/logout` server route. That route clears the platform session cookie and returns the browser to the signed-out application path. The client bootstrap removes the preview token again when it receives the signed-out marker, preventing a stale preview fallback session from re-authenticating subsequent requests.
