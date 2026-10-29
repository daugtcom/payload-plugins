import type { Payload } from 'payload'
import type { ResolvedNewsletterOptions } from './options'
import { findByEmail, normalizeEmail, sendOptInMail } from './subscribe'

type Doc = Record<string, any>

/** CSV text → rows. Handles a BOM, `,` or `;` (the first line decides), quoted fields with doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

export interface ImportRow { email: string; name?: string; status?: 'confirmed' | 'unsubscribed' | 'bounced' | 'complained' | 'pending'; consentAt?: string }

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_\-.]+/g, '')
const EMAIL_H = ['email', 'emailadresse', 'mail', 'emailaddress', 'eadresse', 'emailadress']
const NAME_H = ['name', 'fullname', 'vollername', 'vorundnachname']
const FIRST_H = ['firstname', 'vorname', 'first']
const LAST_H = ['lastname', 'nachname', 'surname', 'last']
const STATUS_H = ['status', 'state']
const DATE_H = ['consent', 'consentdate', 'consentat', 'optindate', 'subscribed', 'subscribedate', 'subscribedat', 'date', 'datum', 'anmeldedatum', 'cdate', 'created']

const mapStatus = (v: string): ImportRow['status'] | undefined => {
  const s = v.trim().toLowerCase()
  if (!s) return undefined
  if (/(unsub|abgemeldet|opt.?out|abbestellt)/.test(s)) return 'unsubscribed'
  if (/(bounce|unzustellbar|invalid)/.test(s)) return 'bounced'
  if (/(complain|spam)/.test(s)) return 'complained'
  if (/(pending|unconfirmed|offen|wartet)/.test(s)) return 'pending'
  if (/(active|aktiv|subscribed|confirmed|bestätigt|bestaetigt)/.test(s)) return 'confirmed'
  return undefined
}
const parseDate = (v: string): string | undefined => {
  const t = v.trim()
  if (!t) return undefined
  const de = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  const d = de ? new Date(Date.UTC(+de[3]!, +de[2]! - 1, +de[1]!)) : new Date(t)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export interface ParsedCsv { rows: ImportRow[]; invalid: string[]; duplicates: number; unknownHeader: boolean }

/** Headers of ActiveCampaign / Mailchimp / own lists: Email, First Name + Last Name or Name, Status, a consent date. */
export function parseSubscribers(text: string): ParsedCsv {
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], invalid: [], duplicates: 0, unknownHeader: true }
  const head = table[0]!.map(norm)
  const col = (names: string[]) => head.findIndex((h) => names.includes(h))
  let emailCol = col(EMAIL_H)
  const hasHeader = emailCol >= 0
  // no header at all: first column is the address
  if (!hasHeader) emailCol = table[0]!.findIndex((c) => normalizeEmail(c))
  if (emailCol < 0) return { rows: [], invalid: [], duplicates: 0, unknownHeader: true }
  const nameCol = col(NAME_H), firstCol = col(FIRST_H), lastCol = col(LAST_H), statusCol = col(STATUS_H), dateCol = col(DATE_H)
  const seen = new Set<string>()
  const rows: ImportRow[] = []
  const invalid: string[] = []
  let duplicates = 0
  for (const r of hasHeader ? table.slice(1) : table) {
    const raw = (r[emailCol] ?? '').trim()
    if (!raw) continue
    const email = normalizeEmail(raw)
    if (!email) { invalid.push(raw); continue }
    if (seen.has(email)) { duplicates++; continue }
    seen.add(email)
    const name = (nameCol >= 0 ? r[nameCol] : [firstCol >= 0 ? r[firstCol] : '', lastCol >= 0 ? r[lastCol] : ''].filter(Boolean).join(' '))?.trim()
    rows.push({ email, name: name || undefined, status: statusCol >= 0 ? mapStatus(r[statusCol] ?? '') : undefined, consentAt: dateCol >= 0 ? parseDate(r[dateCol] ?? '') : undefined })
  }
  return { rows, invalid, duplicates, unknownHeader: false }
}

export interface ImportSummary {
  total: number
  /** new addresses that will be (or were) added */
  new: number
  /** already in the list: left as they are */
  existing: number
  invalid: number
  duplicates: number
  /** in the file as unsubscribed / bounced / complained: added as such, never mailed */
  suppressed: number
  mode: 'reconfirm' | 'already-consented'
  dryRun: boolean
  /** double opt-in mails sent (reconfirm mode) */
  mailed: number
  invalidSamples: string[]
}

export class ImportError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

/**
 * Staff import. `reconfirm` (default): everyone new becomes pending and gets the double opt-in mail, so each person confirms again.
 * `already-consented`: only with an explicit attestation (what the person in charge confirms, stored on every row); new addresses
 * become confirmed with source "import". Addresses the file marks unsubscribed/bounced/complained are added as such in both modes
 * and never mailed. Existing subscribers are never changed.
 */
export async function importSubscribers(payload: Payload, o: ResolvedNewsletterOptions, input: { csv: string; mode?: 'reconfirm' | 'already-consented'; attest?: boolean | string; dryRun?: boolean; ip?: string | null }): Promise<ImportSummary> {
  const mode = input.mode === 'already-consented' ? 'already-consented' : 'reconfirm'
  const dryRun = input.dryRun !== false // dry run unless explicitly turned off
  if (mode === 'already-consented' && !dryRun && !(input.attest === true || (typeof input.attest === 'string' && input.attest.trim().length >= 10 && input.attest !== 'false'))) {
    throw new ImportError('attestation-required', 'Für den Import mit bestehender Einwilligung ist eine ausdrückliche Bestätigung nötig.')
  }
  const parsed = parseSubscribers(input.csv)
  if (parsed.unknownHeader) throw new ImportError('no-email-column', 'In der Datei wurde keine Spalte mit E-Mail-Adressen gefunden.')
  const attestation = typeof input.attest === 'string' && input.attest.trim().length >= 10 ? input.attest.trim() : 'Die Einwilligung der Personen in dieser Liste liegt nachweislich vor (bestätigt beim Import).'
  const summary: ImportSummary = { total: parsed.rows.length + parsed.invalid.length + parsed.duplicates, new: 0, existing: 0, invalid: parsed.invalid.length, duplicates: parsed.duplicates, suppressed: 0, mode, dryRun, mailed: 0, invalidSamples: parsed.invalid.slice(0, 5) }
  const now = new Date().toISOString()
  for (const r of parsed.rows) {
    if (await findByEmail(payload, o, r.email)) { summary.existing++; continue }
    summary.new++
    const suppressed = r.status === 'unsubscribed' || r.status === 'bounced' || r.status === 'complained'
    if (suppressed) summary.suppressed++
    if (dryRun) continue
    const status = suppressed ? (r.status as string) : mode === 'already-consented' ? 'confirmed' : 'pending'
    const doc = (await payload.create({
      collection: o.subscribersSlug as never,
      data: {
        email: r.email, name: r.name, status,
        consentAt: r.consentAt ?? now, consentSource: 'import', consentIp: input.ip ?? undefined,
        ...(status === 'confirmed' ? { confirmedAt: r.consentAt ?? now, consentNote: attestation } : {}),
        ...(status === 'pending' ? { consentNote: 'Import: Bestätigung per E-Mail angefordert.' } : {}),
        ...(suppressed ? { unsubscribedAt: now, consentNote: 'Import: in der Datei bereits abgemeldet bzw. unzustellbar.' } : {}),
      } as never,
      overrideAccess: true, depth: 0,
    })) as Doc
    if (status === 'pending' && (await sendOptInMail(payload, o, doc))) summary.mailed++
  }
  return summary
}
