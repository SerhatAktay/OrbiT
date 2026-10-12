// Annotation parsers. All return { chrom, name, start, end, strand, type } with
// 0-based half-open coordinates. end < start marks a feature that wraps the origin.

const strandOf = (s) => (s === '+' || s === '-' ? s : null)

export function parseBed(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^(track|browser)\b/.test(line))
    .map((line) => {
      const fields = line.split(/\t| +/)
      if (fields.length < 3) {
        throw new Error(`Invalid BED line (need at least 3 fields): "${line}"`)
      }
      const [chrom, startStr, endStr, name, , strand] = fields
      const start = Number(startStr)
      const end = Number(endStr)
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error(`Invalid BED coordinates: "${line}"`)
      }
      return {
        chrom,
        name: name || `feature_${start}_${end}`,
        start,
        end,
        strand: strandOf(strand),
        type: 'feature',
      }
    })
}

const ATTR_KEYS = ['gene_name', 'Name', 'gene', 'gene_id', 'locus_tag', 'product', 'ID']

function attrValue(attributes, key) {
  const m =
    attributes.match(new RegExp(`(?:^|[;\\s])${key}\\s*=\\s*([^;]+)`)) || // GFF3  key=value
    attributes.match(new RegExp(`(?:^|[;\\s])${key}\\s+"([^"]+)"`)) // GTF   key "value"
  if (!m) return null
  try {
    return decodeURIComponent(m[1].trim())
  } catch {
    return m[1].trim()
  }
}

function gtfRow(line) {
  const fields = line.split('\t')
  if (fields.length < 9) {
    throw new Error(`Invalid GTF line (need 9 fields): "${line}"`)
  }
  const [chrom, , type, startStr, endStr, , strand, , attributes] = fields
  const start = Number(startStr) - 1
  const end = Number(endStr)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`Invalid GTF coordinates: "${line}"`)
  }
  const key = ATTR_KEYS.find((k) => attrValue(attributes, k))
  return {
    chrom,
    name: key ? attrValue(attributes, key) : `feature_${start}_${end}`,
    start,
    end,
    strand: strandOf(strand),
    type,
  }
}

const SKIP_TYPES = ['region', 'chromosome', 'source', 'supercontig']

// GTF and GFF3 (same 9 columns). Files repeat a gene as gene/transcript/exon/CDS;
// when genes are present keep only those so each gene draws once.
export function parseGtf(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(gtfRow)
    .filter((f) => !SKIP_TYPES.includes(f.type))
  return rows.some((f) => f.type === 'gene') ? rows.filter((f) => f.type === 'gene') : rows
}

// Whole-genome GTF from an async iterable of lines (a 1.5M-line file never sits
// in memory as one string). Keeps gene rows; files without them (UCSC) get one
// feature per gene_id spanning its transcripts.
export async function parseGtfLines(lines) {
  const genes = []
  const merged = new Map()
  for await (const line of lines) {
    if (!line || line[0] === '#') continue
    const type = line.split('\t', 3)[2]
    if (type !== 'gene' && type !== 'transcript') continue
    const row = gtfRow(line)
    if (type === 'gene') {
      genes.push(row)
      continue
    }
    const id = `${row.chrom}\t${attrValue(line.split('\t')[8], 'gene_id') ?? row.name}`
    const m = merged.get(id)
    if (m) {
      m.start = Math.min(m.start, row.start)
      m.end = Math.max(m.end, row.end)
    } else merged.set(id, { ...row, type: 'gene' })
  }
  return genes.length ? genes : [...merged.values()]
}

// GenBank flat file. Locations: a..b, complement(...), join(a..b,c..d). A join
// that steps backwards (c < b) wraps the origin and becomes end < start.
export function parseGenBank(text) {
  const chrom = (text.match(/^LOCUS\s+(\S+)/m) || [])[1] || 'genome'
  const chromLength = Number((text.match(/^LOCUS\s+\S+\s+(\d+)\s*bp/im) || [])[1]) || undefined
  const section = text.split(/^FEATURES.*$/m)[1]?.split(/^(?:ORIGIN|CONTIG|BASE COUNT)/m)[0]
  if (!section) throw new Error('no FEATURES table found')
  const rows = []
  let current = null
  for (const line of section.split(/\r?\n/)) {
    const head = line.match(/^ {5}(\S+)\s+(\S.*)$/)
    if (head) {
      current = { type: head[1], loc: head[2], quals: '' }
      rows.push(current)
    } else if (current) {
      const cont = line.trim()
      // Location continuation lines have no leading '/'; qualifiers do.
      if (current.quals === '' && !cont.startsWith('/')) current.loc += cont
      else current.quals += `${cont}\n`
    }
  }
  const qual = (q, key) => (q.match(new RegExp(`/${key}="([^"]*)"`)) || q.match(new RegExp(`/${key}=(\\S+)`)) || [])[1]
  const out = []
  for (const r of rows) {
    if (['source', 'mRNA', 'exon', 'intron', 'misc_feature'].includes(r.type)) continue
    const nums = [...r.loc.matchAll(/(\d+)\.\.>?(\d+)|(\d+)/g)].map((m) => (m[1] ? [Number(m[1]), Number(m[2])] : [Number(m[3]), Number(m[3])]))
    if (!nums.length) continue
    let start = nums[0][0] - 1
    let end = nums[nums.length - 1][1]
    const wraps = nums.length > 1 && nums.slice(1).some((n, i) => n[0] < nums[i][1])
    if (!wraps) {
      start = Math.min(...nums.map((n) => n[0])) - 1
      end = Math.max(...nums.map((n) => n[1]))
    }
    const name = qual(r.quals, 'gene') || qual(r.quals, 'locus_tag') || qual(r.quals, 'product') || `${r.type}_${start + 1}`
    out.push({ chrom, name, start, end, strand: r.loc.includes('complement') ? '-' : '+', type: r.type, chromLength })
  }
  // Like GTF: if genes are annotated, drop the CDS/RNA duplicates of them.
  return out.some((f) => f.type === 'gene') ? out.filter((f) => f.type === 'gene') : out
}

export function parseAnnotation(text, filename) {
  const lower = filename.toLowerCase()
  if (/\.(gb|gbk|gbff|genbank)$/.test(lower)) return parseGenBank(text)
  if (lower.endsWith('.gtf') || lower.endsWith('.gff') || lower.endsWith('.gff3')) {
    return parseGtf(text)
  }
  return parseBed(text)
}

// Sort order for chromosome lists: 1..22 numerically, then X, Y, M, then anything else by name.
export function compareChroms(a, b) {
  const rank = (name) => {
    const n = normChrom(name)
    if (/^\d+$/.test(n)) return [0, Number(n)]
    const i = ['X', 'Y', 'MT'].indexOf(n)
    return i >= 0 ? [1, i] : [2, 0]
  }
  const [ga, na] = rank(a)
  const [gb, nb] = rank(b)
  return ga - gb || na - nb || String(a).localeCompare(String(b), 'en', { numeric: true })
}

// chrM / MT / M / chrMT all name the mitochondrial genome.
export function normChrom(name) {
  const n = String(name).replace(/^chr/i, '').toUpperCase()
  return n === 'M' ? 'MT' : n
}
