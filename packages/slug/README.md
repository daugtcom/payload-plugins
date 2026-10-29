# Automatic slugs

Apply `autoSlug(['pages', 'products', ...])` after the plugins that define the collections. Their existing top-level text slug fields are hidden in the admin and are generated from the title on creation. Existing slugs remain stable when titles change; API and import operations can still supply an explicit slug. Existing uniqueness constraints remain in force.
