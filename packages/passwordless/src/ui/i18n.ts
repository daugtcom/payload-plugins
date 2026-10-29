export type Locale = 'de' | 'en'

const dict = {
  de: {
    login: 'Anmelden', email: 'E-Mail-Adresse', continue: 'Weiter', password: 'Passwort', code: 'Code aus der E-Mail',
    codeSent: 'Wir haben dir einen Code geschickt. Du kannst auch den Link in der E-Mail anklicken.', wrongCode: 'Der Code stimmt nicht.', tooMany: 'Zu viele Versuche. Bitte fordere einen neuen Code an.',
    acceptTerms: 'Ich akzeptiere die AGB und die Datenschutzerklärung.', termsRequired: 'Bitte akzeptiere die AGB und die Datenschutzerklärung.', wrongPassword: 'E-Mail oder Passwort stimmen nicht.',
    forgot: 'Passwort vergessen?', forgotSent: 'Wenn es ein Konto gibt, haben wir dir eine E-Mail geschickt.', back: 'Zurück', loginLead: 'Melde dich an oder lege ein Konto an, wir schicken dir einen Code per E-Mail.',
    emailNotAllowed: 'Mit dieser E-Mail-Adresse können wir kein Konto anlegen. Bitte nimm eine andere.',
    captchaFailed: 'Die Sicherheitsprüfung ist fehlgeschlagen. Bitte versuche es noch einmal.',
    setPassword: 'Passwort festlegen', setPasswordHint: 'Du meldest dich bisher mit einem Code an. Mit einem Passwort geht es schneller.', newPassword: 'Neues Passwort (mind. 8 Zeichen)', saved: 'Gespeichert.', hasPassword: 'Du meldest dich mit deinem Passwort an.', changePassword: 'Passwort ändern', currentPassword: 'Aktuelles Passwort', passwordChanged: 'Dein Passwort wurde geändert.', passwordTooShort: 'Das Passwort braucht mindestens 8 Zeichen.', wrongCurrentPassword: 'Das aktuelle Passwort stimmt nicht.', forgotCurrent: 'Aktuelles Passwort vergessen? Melde dich ab und wähle beim Anmelden „Passwort vergessen“.',
    termsGateTitle: 'Bitte bestätige unsere Bedingungen', termsGateText: 'Wir haben unsere AGB und Datenschutzerklärung aktualisiert. Bitte bestätige sie, um fortzufahren.', accept: 'Akzeptieren',
    profileAvatar: 'Profilbild', changeAvatar: 'Bild ändern', removeAvatar: 'Entfernen', avatarHint: 'JPG, PNG, WebP oder GIF, höchstens {max} MB.', avatarTooBig: 'Das Bild ist zu groß (höchstens {max} MB).', avatarWrongType: 'Bitte wähle ein JPG-, PNG-, WebP- oder GIF-Bild.', avatarForbidden: 'Das Hochladen von Bildern ist hier gerade nicht möglich.', avatarFailed: 'Das Bild konnte nicht hochgeladen werden. Bitte versuche es noch einmal.',
    userName: 'Benutzername', fullName: 'Vollständiger Name', save: 'Speichern', saving: 'Wird gespeichert …', nameRequired: 'Bitte gib einen Benutzernamen an.', tooLong: 'Die Eingabe ist zu lang (höchstens 120 Zeichen).', genericError: 'Das hat nicht geklappt. Bitte versuche es noch einmal.', loginRequired: 'Bitte melde dich erneut an.',
    changeEmail: 'E-Mail-Adresse ändern', currentEmail: 'Aktuelle Adresse', newEmail: 'Neue E-Mail-Adresse', sendCode: 'Code senden', sending: 'Wird gesendet …', emailCodeSent: 'Wir haben einen Code an {email} geschickt.', confirmCode: 'Bestätigen', confirming: 'Wird geprüft …', emailChanged: 'Deine E-Mail-Adresse wurde geändert.', codeLabel: '6-stelliger Code', cancel: 'Abbrechen',
    emailTaken: 'Diese Adresse gehört bereits zu einem anderen Konto.', emailUnchanged: 'Das ist bereits deine aktuelle Adresse.', emailInvalid: 'Bitte gib eine gültige E-Mail-Adresse ein.', tooManyRequests: 'Zu viele Anfragen. Bitte warte einen Moment.', codeExpired: 'Der Code ist abgelaufen oder stimmt nicht. Bitte fordere einen neuen an.', impersonating: 'Während der Ansicht als Mitglied kann die Adresse nicht geändert werden.',
  },
  en: {
    login: 'Log in', email: 'Email address', continue: 'Continue', password: 'Password', code: 'Code from the email',
    codeSent: 'We sent you a code. You can also click the link in the email.', wrongCode: 'That code is not right.', tooMany: 'Too many attempts. Please request a new code.',
    acceptTerms: 'I accept the terms and the privacy policy.', termsRequired: 'Please accept the terms and the privacy policy.', wrongPassword: 'Email or password is wrong.',
    forgot: 'Forgot your password?', forgotSent: 'If there is an account, we sent you an email.', back: 'Back', loginLead: 'Log in or create an account: we email you a code.',
    emailNotAllowed: 'We cannot create an account with this address. Please use another one.',
    captchaFailed: 'The security check failed. Please try again.',
    setPassword: 'Set a password', setPasswordHint: 'You sign in with a code so far. A password is quicker.', newPassword: 'New password (at least 8 characters)', saved: 'Saved.', hasPassword: 'You sign in with your password.', changePassword: 'Change password', currentPassword: 'Current password', passwordChanged: 'Your password was changed.', passwordTooShort: 'The password needs at least 8 characters.', wrongCurrentPassword: 'The current password is not right.', forgotCurrent: 'Forgot your current password? Log out and choose "Forgot your password?" when logging in.',
    termsGateTitle: 'Please confirm our terms', termsGateText: 'We updated our terms and privacy policy. Please confirm them to continue.', accept: 'Accept',
    profileAvatar: 'Profile picture', changeAvatar: 'Change picture', removeAvatar: 'Remove', avatarHint: 'JPG, PNG, WebP or GIF, up to {max} MB.', avatarTooBig: 'The picture is too large (up to {max} MB).', avatarWrongType: 'Please choose a JPG, PNG, WebP or GIF picture.', avatarForbidden: 'Uploading pictures is not possible here right now.', avatarFailed: 'The picture could not be uploaded. Please try again.',
    userName: 'Username', fullName: 'Full name', save: 'Save', saving: 'Saving …', nameRequired: 'Please enter a username.', tooLong: 'That is too long (at most 120 characters).', genericError: 'That did not work. Please try again.', loginRequired: 'Please log in again.',
    changeEmail: 'Change email address', currentEmail: 'Current address', newEmail: 'New email address', sendCode: 'Send code', sending: 'Sending …', emailCodeSent: 'We sent a code to {email}.', confirmCode: 'Confirm', confirming: 'Checking …', emailChanged: 'Your email address was changed.', codeLabel: '6-digit code', cancel: 'Cancel',
    emailTaken: 'This address already belongs to another account.', emailUnchanged: 'That is already your current address.', emailInvalid: 'Please enter a valid email address.', tooManyRequests: 'Too many requests. Please wait a moment.', codeExpired: 'The code expired or is wrong. Please request a new one.', impersonating: 'The address cannot be changed while viewing as a member.',
  },
} as const

export const t = (locale: Locale = 'de') => dict[locale]
