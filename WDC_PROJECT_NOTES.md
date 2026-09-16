# WDC Project Notes

## Working Style

- Explain technical ideas in simple, practical language before introducing jargon.
- Make requested changes directly, but do not make extra behavior changes unless requested.
- Keep the user informed about what is finished and what is still not built.

## UI Preferences

- Icons must have a clear, familiar meaning and a real click action when they appear interactive.
- Success notifications should close automatically; errors should remain until dismissed.
- On mobile, do not squeeze the full dashboard navigation into the top bar.
- Use a three-line hamburger button that opens a slide-out sidebar drawer on mobile.
- The mobile drawer must scroll independently, lock background-page scrolling while open, and hide its visible scrollbar.
- Keep dashboard pages practical and dense rather than marketing-like.

## Current Product Decisions

- API-key rotation keeps the old key active until the customer updates their system and revokes it.
- WDC uses API keys for incoming events and HMAC signatures for outgoing webhooks.
- Password reset currently creates a local reset token; production should deliver reset links by email.
- Staff access is structured around Owner, Admin, Developer, and Viewer roles.
