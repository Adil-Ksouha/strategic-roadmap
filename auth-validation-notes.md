# Private Authentication Validation Notes

## Scope

Architecture Master Roadmap now uses **administrator-managed private email/password accounts**. Google federation and Google email-allowlist logic are not used by the application access path.

## Controls Implemented

| Control | Validation outcome |
| --- | --- |
| Password storage | Passwords are salted with Node.js `scrypt` and compared with a constant-time equality check. Plain-text passwords are not stored or returned. |
| Initial administrator | `/?setup=1` displays the first-administrator form only while no local administrator account exists. Submission also requires the configured one-time bootstrap token. |
| Session enforcement | Portfolio procedures require a current account whose `loginMethod` is `local` and whose status is `active`. |
| Legacy-path rejection | Session handling no longer accepts a preview bearer fallback or auto-provisions a user from an OAuth identity. |
| Administration lifecycle | Executive administrators can create/reset accounts, change assignment, disable/reactivate non-admin accounts, and permanently remove non-admin accounts. Existing administrator roles cannot be accidentally downgraded through an account reset. |

## Validation Performed

| Check | Result |
| --- | --- |
| TypeScript check | Passed. |
| Vitest suite | Passed: 26 tests across 10 files. Coverage includes password hashing, configured bootstrap-token validation, valid/invalid login behavior, one-time bootstrap and setup-status behavior, active-local procedure enforcement, and executive account-action protection. |
| Production build | Passed. The existing Vite bundle-size warning remains non-blocking. |
| Signed-out interface | Verified in preview: the private email/password screen renders with no Google entry point. |
| Setup interface | Verified in preview: the first-administrator form renders at `/?setup=1` before a local administrator exists. |

## Required First Setup

1. The platform owner opens the preview at `/?setup=1`.
2. The owner enters their own private email, a strong password, and the bootstrap token retrieved securely from the project’s **Secrets** settings.
3. The first local administrator account is created and signed in. The setup form subsequently becomes unavailable.
4. The administrator uses **Team Access** to create user accounts and provides each password to the intended user through an approved private channel.

No AWS deployment has been performed for this private-authentication change. The existing App Runner environment still requires an approved follow-up deployment after preview acceptance.
