# Admin labels

Apply `adminLabels()` after the other Payload plugins. Default entity and group labels are supplied in German and English. Pass `collections`, `globals` or `groups` to override labels or add custom slugs; for example `adminLabels({ collections: { lessons: { singular: { de: 'Lektion', en: 'Lesson' }, plural: { de: 'Lektionen', en: 'Lessons' } } } })`. The site's Payload `i18n.supportedLanguages` controls which admin languages are available. This changes display labels only, not collection slugs or data.
