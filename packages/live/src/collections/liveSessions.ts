import type { CollectionConfig, Field, Where } from 'payload'
import type { ResolvedLive } from '../options'

const RECORDING_STATES = ['starting', 'recording', 'processing', 'ready', 'failed'] as const

const recordingFields: Field[] = [
  { name: 'record', type: 'checkbox', defaultValue: false, label: 'Aufzeichnen', admin: { description: 'Der Raum wird aufgenommen, sobald jemand beitritt. Alle sehen im Raum den Hinweis „Aufnahme“.' } },
  {
    name: 'recordings',
    type: 'array',
    label: 'Aufnahmen',
    admin: { readOnly: true, initCollapsed: true },
    fields: [
      { name: 'egressId', type: 'text', required: true, index: true },
      { name: 'status', type: 'select', defaultValue: 'starting', options: RECORDING_STATES.map((v) => ({ label: v, value: v })), required: true },
      { type: 'row', fields: [{ name: 'startedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } }, { name: 'endedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } }] },
      { type: 'row', fields: [{ name: 'durationSeconds', type: 'number' }, { name: 'sizeBytes', type: 'number' }] },
      { name: 'fileKey', type: 'text', admin: { description: 'Pfad der Datei im Speicher.' } },
      { name: 'error', type: 'text' },
    ],
  },
  // the list column: links to every finished recording (server component, no client code)
  { name: 'recordingLinks', type: 'ui', label: 'Aufnahmen', admin: { components: { Cell: '@daugtcom/payload-live/admin#RecordingLinks', Field: '@daugtcom/payload-live/admin#RecordingLinks' } } },
]

/** One scheduled call: a room, a time window, who hosts and (for direct calls) who may join. Group calls are created from a block when the first member joins. */
export function liveSessions(o: ResolvedLive): CollectionConfig {
  const staff = ({ req }: { req: { user?: unknown } }) => o.isStaff(req.user)
  return {
    slug: o.slug,
    labels: { singular: 'Live-Termin', plural: 'Live-Termine' },
    admin: { useAsTitle: 'title', defaultColumns: ['title', 'kind', 'startsAt', 'status', 'recordingLinks'], group: 'Live' },
    access: {
      read: ({ req }): boolean | Where => {
        const user = req.user as { id: string | number } | null
        if (!user) return false
        if (o.isStaff(user)) return true
        return { or: [{ participants: { contains: user.id } }, { hosts: { contains: user.id } }] }
      },
      create: staff,
      update: staff,
      delete: staff,
    },
    timestamps: true,
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'kind', type: 'select', defaultValue: 'group', options: [{ label: 'Gruppe (Block in einem Beitrag)', value: 'group' }, { label: 'Einzeltermin', value: 'direct' }], required: true },
      { name: 'status', type: 'select', defaultValue: 'scheduled', options: ['scheduled', 'live', 'ended', 'cancelled'], required: true },
      { type: 'row', fields: [{ name: 'startsAt', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayAndTime' } } }, { name: 'endsAt', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayAndTime' } } }] },
      { name: 'room', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true, description: 'Name of the LiveKit room.' } },
      { name: 'hosts', type: 'relationship', relationTo: o.usersSlug, hasMany: true, admin: { description: 'Staff always host. List more hosts here.' } },
      { name: 'participants', type: 'relationship', relationTo: o.usersSlug, hasMany: true, admin: { description: 'Direct calls: exactly the people who may join (besides hosts and staff).' } },
      { name: 'allowSpeak', type: 'select', defaultValue: 'host', options: [{ label: 'Alle', value: 'all' }, { label: 'Handzeichen', value: 'raise-hand' }, { label: 'Nur Gastgeberin', value: 'host' }] },
      { name: 'capacity', type: 'number' },
      ...recordingFields, // always there, so the schema and the admin import map do not depend on the environment
      { name: 'startedAt', type: 'date', admin: { readOnly: true } },
      { name: 'endedAt', type: 'date', admin: { readOnly: true } },
      { type: 'row', fields: [{ name: 'sourceKind', type: 'text', index: true }, { name: 'sourceCollection', type: 'text' }, { name: 'sourceID', type: 'text' }, { name: 'blockID', type: 'text' }] },
    ],
  }
}
