#!/usr/bin/env node
/**
 * Diagnostico degli endpoint configurati in .env.
 *
 * La logica di sonda vive in `@nmc/nostr-core` (relays/probe.ts), condivisa
 * con la pagina /diagnostica dell'app: qui c'e' solo la presentazione a
 * terminale. Cosi' riga di comando e browser danno per costruzione la stessa
 * diagnosi.
 *
 * Uso:  pnpm check:endpoints
 *       (il nome "doctor" non e' utilizzabile: e' un comando interno di pnpm
 *        e avrebbe la precedenza sullo script del workspace)
 *
 * Nessuna chiave privata viene usata o richiesta.
 */

import {
  checkBlossomServer,
  checkRelay,
  resolveClientConfig,
} from '../packages/nostr-core/dist/index.js'

/** NIP che il client usa e che vale la pena vedere dichiarati da un relay. */
const NIP_INTERESSANTI = {
  1: 'base',
  9: 'cancellazione',
  11: 'info relay',
  17: 'DM privati',
  22: 'commenti',
  23: 'long-form',
  42: 'AUTH',
  50: 'ricerca',
  52: 'calendario',
  65: 'outbox',
}

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
}

const ok = (s) => `${c.green}✓${c.reset} ${s}`
const ko = (s) => `${c.red}✗${c.reset} ${s}`
const warn = (s) => `${c.yellow}▲${c.reset} ${s}`
const info = (s) => `${c.dim}·${c.reset} ${s}`

function stampaRelay(check, ruoli) {
  const { url, probe, info: doc, infoError } = check
  console.log(`\n${c.bold}${url}${c.reset}`)

  if (probe.reachable) {
    console.log(ok(`risponde in ${probe.firstDataMs ?? probe.connectMs} ms`))
    if (probe.retried) {
      console.log(warn('il primo tentativo era fallito: relay instabile o con rate limit per IP'))
    }
  } else {
    console.log(ko(`connessione: ${probe.error ?? 'nessun dato'}`))
  }

  if (probe.authRequested) {
    console.log(warn('richiede AUTH (NIP-42): serve una chiave anche solo per leggere'))
  }
  if (probe.closedReason) console.log(warn(`sottoscrizione rifiutata: ${probe.closedReason}`))
  for (const n of probe.notices) console.log(info(`NOTICE: ${n}`))

  if (infoError) {
    console.log(info(`NIP-11 non leggibile (${infoError}) — non e' bloccante`))
  } else if (doc) {
    if (doc.name) console.log(info(`nome: ${doc.name}`))
    if (doc.software) {
      console.log(info(`software: ${String(doc.software).split('/').pop()} ${doc.version ?? ''}`))
    }

    const nips = Array.isArray(doc.supported_nips) ? doc.supported_nips : []
    const presenti = Object.entries(NIP_INTERESSANTI)
      .filter(([n]) => nips.includes(Number(n)))
      .map(([n, label]) => `${n} ${label}`)
    const mancanti = Object.entries(NIP_INTERESSANTI)
      .filter(([n]) => !nips.includes(Number(n)))
      .map(([n, label]) => `${n} ${label}`)

    if (presenti.length) console.log(info(`NIP dichiarati: ${presenti.join(', ')}`))
    if (mancanti.length)
      console.log(info(`${c.dim}non dichiarati: ${mancanti.join(', ')}${c.reset}`))

    const lim = doc.limitation ?? {}
    if (lim.payment_required) {
      console.log(warn(`a pagamento — listino: ${doc.payments_url ?? 'non indicato'}`))
      if (doc.fees) console.log(info(`fees: ${JSON.stringify(doc.fees)}`))
    }
    if (lim.auth_required) console.log(warn('auth_required: true'))
    if (lim.restricted_writes) {
      console.log(warn('restricted_writes: true — scrittura non aperta a tutti'))
    }
    if (lim.max_message_length) console.log(info(`max messaggio: ${lim.max_message_length} byte`))
  }

  console.log(info(`ruoli: ${ruoli.join(', ')}`))
}

function stampaBlossom(check) {
  console.log(`\n${c.bold}${check.url}${c.reset}`)
  if (!check.reachable) {
    console.log(ko(`irraggiungibile: ${check.error}`))
    return
  }
  if (check.speaksBlossom) {
    console.log(ok('risponde 404 su un blob inesistente: parla Blossom (BUD-01)'))
  } else {
    console.log(warn('non ha risposto 404 a un blob inesistente: potrebbe non essere Blossom'))
  }
  if (check.uploadHint) {
    const linea = `HEAD /upload → ${check.uploadStatus ?? '?'}: ${check.uploadHint}`
    console.log(check.uploadStatus === 401 ? ok(linea) : warn(linea))
  }
}

// --- esecuzione -------------------------------------------------------------

let config
try {
  config = resolveClientConfig(process.env)
} catch (err) {
  console.error(`\n${c.red}Configurazione non valida${c.reset}\n`)
  console.error(err.message)
  process.exit(1)
}

console.log(`${c.bold}${c.blue}Diagnostico endpoint${c.reset}`)
console.log(`${c.dim}Tutte le verifiche sono anonime e in sola lettura.${c.reset}`)

// Lo stesso relay compare spesso in piu' ruoli. Va interrogato una volta sola:
// molti relay limitano le connessioni concorrenti per IP, quindi una seconda
// sonda in parallelo verrebbe rifiutata e produrrebbe un falso negativo.
const ruoliPerRelay = new Map()
const aggiungiRuolo = (url, ruolo) => {
  if (!url) return
  ruoliPerRelay.set(url, [...(ruoliPerRelay.get(url) ?? []), ruolo])
}

for (const u of config.readRelays) aggiungiRuolo(u, 'lettura')
for (const u of config.writeRelays) aggiungiRuolo(u, 'scrittura')
for (const u of config.indexerRelays) aggiungiRuolo(u, 'indicizzatore')
aggiungiRuolo(config.draftRelay, 'bozze')

const esiti = []

if (ruoliPerRelay.size > 0) {
  console.log(`\n${c.bold}${c.blue}── Relay (${ruoliPerRelay.size} unici) ──${c.reset}`)
  for (const [url, ruoli] of ruoliPerRelay) {
    const check = await checkRelay(url)
    stampaRelay(check, ruoli)
    esiti.push({ url, alive: check.probe.reachable })
  }
}

if (!config.draftRelay) {
  console.log(`\n${c.bold}Relay bozze (kind 30024)${c.reset}`)
  console.log(
    info(
      'non configurato: il salvataggio bozze resta disabilitato (ADR 0003), non ripiega su relay pubblici',
    ),
  )
}

console.log(`\n${c.bold}${c.blue}── Server Blossom ──${c.reset}`)
if (config.blossomServers.length === 0) {
  console.log(warn('nessuno configurato: gli upload media non saranno possibili'))
} else {
  for (const url of config.blossomServers) {
    const check = await checkBlossomServer(url)
    stampaBlossom(check)
    esiti.push({ url: check.url, alive: check.reachable })
  }
}

const morti = esiti.filter((e) => !e.alive)
console.log(`\n${c.bold}Riepilogo${c.reset}`)
console.log(`  endpoint verificati: ${esiti.length}`)
console.log(`  raggiungibili:       ${esiti.length - morti.length}`)
if (morti.length > 0) {
  console.log(`  ${c.red}non raggiungibili:   ${morti.length}${c.reset}`)
  for (const m of morti) console.log(`    - ${m.url}`)
}
console.log()

process.exit(morti.length > 0 ? 1 : 0)
