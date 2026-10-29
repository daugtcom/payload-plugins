# @daugtcom/payload-mail

Shared React Email templates and branding for the Payload plugins. Define a `MailTheme` once and pass it as `theme` to newsletter or `mailTheme` to booking, passwordless and access notification options. Custom `mailLayout` / `renderEmail` callbacks take precedence. `mailLayout(theme)` and the themed login, email-change and notification helpers remain available for existing sites.

`MailShell` and `MailButton` are reusable email-safe components. `renderMail` renders the built-in transactional template as HTML and plain text, and `renderEmail` renders arbitrary React Email content as HTML and text. Newsletter owns its editor blocks and uses the shared shell and button. Payload's configured email adapter sends the output.

`@daugtcom/payload-access/mail` remains a compatibility re-export. React and React DOM are peer dependencies; Next.js consumers should include `@daugtcom/payload-mail` in `transpilePackages`.
