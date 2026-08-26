#!/usr/bin/env node
/**
 * Guardia sulle dipendenze critiche del monorepo.
 *
 * Blinda le due trappole individuate in fase di specifica (docs/adr/0002):
 *
 *  1. `applesauce-factory` e' fermo alla 4.x e dipende da applesauce-core@^4.3.0,
 *     mentre il resto della famiglia e' 6.2.x. Installarlo significa avere due
 *     copie di applesauce-core in bundle, quindi due identita' della classe
 *     EventStore: gli `instanceof` falliscono e gli eventi non si propagano.
 *     Nella 6.x le factory vivono in `applesauce-core/factories`.
 *
 *  2. applesauce-core e applesauce-relay dichiarano `"nostr-tools": "~2.19"`.
 *     Se un package del workspace chiede ^2.25 si ottengono due copie di
 *     nostr-tools, con due tabelle di codifica nip19 distinte.
 *
 * Esce con codice 1 al primo problema, cosi' la CI si ferma.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Pacchetti che non devono comparire in nessun package.json del workspace. */
const FORBIDDEN = {
  'applesauce-factory':
    'fermo alla 4.x, tira dentro una seconda copia di applesauce-core. ' +
    'Le factory della 6.x sono in `applesauce-core/factories`.',
}

/** Pacchetti che devono essere pinnati a una versione esatta. */
const PINNED = {
  'nostr-tools': '2.19.4',
}

/** Famiglie che devono risolversi a una sola copia in node_modules. */
const SINGLETONS = ['applesauce-core', 'nostr-tools']

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

const problems = []

function findPackageJsons(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === '.nuxt')
      continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) findPackageJsons(full, found)
    else if (entry === 'package.json') found.push(full)
  }
  return found
}

// --- 1. Controllo dei manifest del workspace -------------------------------

for (const manifestPath of findPackageJsons(ROOT)) {
  const rel = relative(ROOT, manifestPath)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    problems.push(`${rel}: JSON non valido (${err.message})`)
    continue
  }

  for (const field of DEP_FIELDS) {
    const deps = manifest[field]
    if (!deps) continue

    for (const [name, range] of Object.entries(deps)) {
      if (FORBIDDEN[name]) {
        problems.push(`${rel} → ${field}.${name} e' vietato: ${FORBIDDEN[name]}`)
      }
      if (PINNED[name]) {
        const expected = PINNED[name]
        // Accetta sia il pin diretto sia il riferimento al catalog di pnpm,
        // che a sua volta e' verificato piu' sotto.
        const viaCatalog = range === 'catalog:' || range.startsWith('catalog:')
        if (!viaCatalog && range !== expected) {
          problems.push(
            `${rel} → ${field}.${name} = "${range}", atteso il pin esatto "${expected}" ` +
              `(o "catalog:"). Un range piu' largo duplica il pacchetto in bundle.`,
          )
        }
      }
    }
  }
}

// --- 2. Controllo del catalog in pnpm-workspace.yaml ------------------------

const workspaceFile = join(ROOT, 'pnpm-workspace.yaml')
if (existsSync(workspaceFile)) {
  const yaml = readFileSync(workspaceFile, 'utf8')
  for (const [name, expected] of Object.entries(PINNED)) {
    const match = yaml.match(new RegExp(`^\\s+${name}:\\s*(\\S+)\\s*$`, 'm'))
    if (match && match[1] !== expected) {
      problems.push(`pnpm-workspace.yaml → catalog.${name} = "${match[1]}", atteso "${expected}".`)
    }
  }
  for (const name of Object.keys(FORBIDDEN)) {
    if (new RegExp(`^\\s+${name}:`, 'm').test(yaml)) {
      problems.push(`pnpm-workspace.yaml → catalog.${name} e' vietato: ${FORBIDDEN[name]}`)
    }
  }
}

// --- 3. Controllo delle copie effettive dopo l'install ----------------------

const store = join(ROOT, 'node_modules', '.pnpm')
if (existsSync(store)) {
  const entries = readdirSync(store)
  for (const pkg of SINGLETONS) {
    // Le directory dello store pnpm hanno forma "<nome>@<versione>_<peer-hash>".
    const versions = new Set()
    for (const entry of entries) {
      const m = entry.match(new RegExp(`^${pkg}@(\\d+\\.\\d+\\.\\d+[^_]*)`))
      if (m) versions.add(m[1])
    }
    if (versions.size > 1) {
      problems.push(
        `node_modules/.pnpm contiene ${versions.size} versioni di ${pkg}: ` +
          `${[...versions].sort().join(', ')}. Deve essercene una sola.`,
      )
    }
  }
} else {
  console.log(
    '· store pnpm assente: salto il controllo delle copie duplicate (esegui pnpm install)',
  )
}

// --- Esito -----------------------------------------------------------------

if (problems.length > 0) {
  console.error('\n✗ guard-deps: trovati problemi sulle dipendenze critiche\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nVedi docs/adr/0002-applesauce-6x-e-pin-nostr-tools.md\n')
  process.exit(1)
}

console.log('✓ guard-deps: dipendenze critiche a posto')
