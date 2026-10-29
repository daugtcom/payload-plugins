export type Locale = 'de' | 'en'

const dict = {
  de: {
    live: 'Live', liveNow: 'Jetzt live', startsIn: (s: string) => `Startet in ${s}`, opensIn: (s: string) => `Der Raum öffnet in ${s}`, roomOpen: 'Der Raum ist offen', ended: 'Dieser Live-Termin ist vorbei.', cancelled: 'Dieser Termin wurde abgesagt.',
    join: 'Beitreten', joining: 'Verbinde …', rejoin: 'Erneut beitreten', joinMic: 'Mit Mikrofon beitreten', joinCam: 'Mit Kamera beitreten', addToCalendar: 'Zum Kalender hinzufügen',
    errLogin: 'Bitte melde dich an, um beizutreten.', errForbidden: 'Für diesen Live-Termin hast du keinen Zugang.', errFull: 'Der Raum ist voll.', errEnded: 'Dieser Live-Termin ist vorbei.', errGeneric: 'Das hat nicht geklappt. Bitte versuche es noch einmal.', errNotOpen: 'Der Raum ist noch nicht offen.', login: 'Anmelden',
    left: 'Du hast den Raum verlassen.', mic: 'Mikrofon', cam: 'Kamera', speaker: 'Lautsprecher', devices: 'Geräte wählen', screen: 'Bildschirm teilen', stopScreen: 'Teilen beenden', hand: 'Melden', lowerHand: 'Hand senken', chat: 'Chat', people: 'Teilnehmende', leave: 'Verlassen', fullscreen: 'Vollbild', exitFullscreen: 'Vollbild beenden',
    chatPlaceholder: 'Nachricht schreiben …', send: 'Senden', noMessages: 'Noch keine Nachrichten.', you: 'Du', host: 'Gastgeberin', handRaised: 'meldet sich',
    mute: 'Stummschalten', allowSpeak: 'Sprechen erlauben', revokeSpeak: 'Sprechen beenden', remove: 'Entfernen', endForAll: 'Für alle beenden', confirmEnd: 'Den Raum für alle beenden?', confirmRemove: 'Diese Person aus dem Raum entfernen?',
    connecting: 'Verbindung wird hergestellt …', reconnecting: 'Verbindung wird wiederhergestellt …', enableSound: 'Ton einschalten', youMaySpeak: 'Du darfst jetzt sprechen.', listening: 'Du hörst zu. Mit „Melden“ kannst du um das Wort bitten.', more: (n: number) => `+ ${n} weitere`, camOff: 'Kamera aus', deviceError: 'Mikrofon oder Kamera konnten nicht gestartet werden. Bitte prüfe die Berechtigungen deines Browsers.',
    days: 'Tg', hours: 'Std', minutes: 'Min', soon: 'gleich',
    recording: 'Aufnahme', recordingOn: 'Aufnahme läuft', recordStart: 'Aufnahme starten', recordStop: 'Aufnahme beenden', recordingFailed: 'Die Aufnahme konnte nicht gestartet werden.',
    recordingNotice: 'Dieser Termin wird aufgezeichnet. Mit dem Beitritt bist du damit einverstanden.',
    recordings: 'Aufnahmen', noRecordings: 'Noch keine Aufnahmen.', watch: 'Ansehen', download: 'Herunterladen', processing: 'Wird verarbeitet …', recordingRunning: 'Läuft gerade', recordingFailedShort: 'Fehlgeschlagen', minutesShort: 'Min.', recordingSoon: 'Die Aufnahme ist gleich verfügbar.',
  },
  en: {
    live: 'Live', liveNow: 'Live now', startsIn: (s: string) => `Starts in ${s}`, opensIn: (s: string) => `The room opens in ${s}`, roomOpen: 'The room is open', ended: 'This live session is over.', cancelled: 'This session was cancelled.',
    join: 'Join', joining: 'Connecting …', rejoin: 'Join again', joinMic: 'Join with microphone', joinCam: 'Join with camera', addToCalendar: 'Add to calendar',
    errLogin: 'Please log in to join.', errForbidden: 'You do not have access to this live session.', errFull: 'The room is full.', errEnded: 'This live session is over.', errGeneric: 'That did not work. Please try again.', errNotOpen: 'The room is not open yet.', login: 'Log in',
    left: 'You left the room.', mic: 'Microphone', cam: 'Camera', speaker: 'Speaker', devices: 'Choose devices', screen: 'Share screen', stopScreen: 'Stop sharing', hand: 'Raise hand', lowerHand: 'Lower hand', chat: 'Chat', people: 'People', leave: 'Leave', fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen',
    chatPlaceholder: 'Write a message …', send: 'Send', noMessages: 'No messages yet.', you: 'You', host: 'Host', handRaised: 'raised a hand',
    mute: 'Mute', allowSpeak: 'Allow to speak', revokeSpeak: 'Stop speaking', remove: 'Remove', endForAll: 'End for everyone', confirmEnd: 'End the room for everyone?', confirmRemove: 'Remove this person from the room?',
    connecting: 'Connecting …', reconnecting: 'Reconnecting …', enableSound: 'Turn on sound', youMaySpeak: 'You can speak now.', listening: 'You are listening. Use "Raise hand" to ask for the floor.', more: (n: number) => `+ ${n} more`, camOff: 'Camera off', deviceError: 'Microphone or camera could not be started. Please check your browser permissions.',
    days: 'd', hours: 'h', minutes: 'min', soon: 'shortly',
    recording: 'Recording', recordingOn: 'Recording', recordStart: 'Start recording', recordStop: 'Stop recording', recordingFailed: 'The recording could not be started.',
    recordingNotice: 'This session is recorded. By joining you agree to that.',
    recordings: 'Recordings', noRecordings: 'No recordings yet.', watch: 'Watch', download: 'Download', processing: 'Processing …', recordingRunning: 'In progress', recordingFailedShort: 'Failed', minutesShort: 'min', recordingSoon: 'The recording will be available shortly.',
  },
} as const

export const t = (locale: Locale = 'de') => dict[locale]
