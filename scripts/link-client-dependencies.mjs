import { existsSync, lstatSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// npm hoists dependencies here. The optional sibling clients need this directory
// on their normal Node resolution path as well as their workspace package links.
const root = fileURLToPath(new URL('../', import.meta.url))
const clients = path.resolve(root, '../clients')
const manifest = path.join(clients, 'package.json')

if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'clients') {
  const source = path.join(root, 'node_modules')
  const destination = path.join(clients, 'node_modules')
  let current
  try {
    current = lstatSync(destination)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  if (!current) {
    symlinkSync(path.relative(clients, source), destination, 'dir')
  } else if (!current.isSymbolicLink() || realpathSync(destination) !== realpathSync(source)) {
    throw new Error('clients/node_modules already exists. Move it aside before installing the shared local workspace from payload-plugins.')
  }
}
