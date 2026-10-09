// test/parse-annotation.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBed, parseGtf, parseAnnotation, normChrom } from '../src/parse-annotation.js'

test('parseBed parses fields and defaults strand to null', () => {
  const text = readFileSync(new URL('./fixtures/sample.bed', import.meta.url), 'utf8')
  const features = parseBed(text)
  assert.equal(features.length, 3)
  assert.deepEqual(features[0], { chrom: 'chrM', name: 'D-loop', start: 0, end: 576, strand: '+', type: 'feature' })
})

test('parseBed rejects malformed lines', () => {
  assert.throws(() => parseBed('chrM\t0\n'), /Invalid BED line/)
})

test('parseGtf converts 1-based inclusive to 0-based half-open and reads gene_name', () => {
  const line = 'chrM\tsource\tgene\t1\t576\t.\t+\t.\tgene_id "ND1"; gene_name "MT-ND1";\n'
  const features = parseGtf(line)
  assert.deepEqual(features[0], { chrom: 'chrM', name: 'MT-ND1', start: 0, end: 576, strand: '+', type: 'gene' })
})

test('parseGtf keeps only genes when present and reads GFF3 Name=', () => {
  const gtf = [
    'chrM\ts\tgene\t1\t100\t.\t+\t.\tgene_id "A";',
    'chrM\ts\texon\t1\t100\t.\t+\t.\tgene_id "A";',
    'chrM\ts\tgene\t200\t300\t.\t-\t.\tID=gene:B;Name=MT-B',
  ].join('\n')
  const f = parseGtf(gtf)
  assert.deepEqual(f.map((x) => x.name), ['A', 'MT-B'])
  assert.equal(f[1].strand, '-')
})

test('normChrom treats chrM, MT and M as one chromosome', () => {
  assert.equal(normChrom('chrM'), normChrom('MT'))
  assert.equal(normChrom('M'), normChrom('chrMT'))
  assert.notEqual(normChrom('chr1'), normChrom('chr2'))
})

test('parseAnnotation dispatches on file extension', () => {
  const bedText = readFileSync(new URL('./fixtures/sample.bed', import.meta.url), 'utf8')
  assert.equal(parseAnnotation(bedText, 'foo.bed').length, 3)
})

test('parseGenBank reads genes, strands and origin-wrapping joins', () => {
  const gb = [
    'LOCUS       NC_012920   16569 bp    DNA     circular',
    'FEATURES             Location/Qualifiers',
    '     source          1..16569',
    '                     /organism="Homo sapiens"',
    '     gene            3307..4262',
    '                     /gene="ND1"',
    '     gene            complement(14149..14673)',
    '                     /gene="ND6"',
    '     gene            join(16024..16569,',
    '                     1..576)',
    '                     /gene="D-loop"',
    'ORIGIN',
    '        1 gatc',
  ].join('\n')
  const f = parseAnnotation(gb, 'x.gbk')
  assert.deepEqual(f.map((x) => [x.name, x.start, x.end, x.strand]), [
    ['ND1', 3306, 4262, '+'],
    ['ND6', 14148, 14673, '-'],
    ['D-loop', 16023, 576, '+'],
  ])
  assert.equal(f[0].chrom, 'NC_012920')
})

test('compareChroms orders 1-22, then X, Y, M, then other contigs', async () => {
  const { compareChroms } = await import('../src/parse-annotation.js')
  const shuffled = ['chrM', 'chr11', 'chrY', 'chr2', 'chrUn_x', 'chr1', 'chrX', 'chr22', 'chr10', 'chr9']
  assert.deepEqual(shuffled.sort(compareChroms), ['chr1', 'chr2', 'chr9', 'chr10', 'chr11', 'chr22', 'chrX', 'chrY', 'chrM', 'chrUn_x'])
  assert.deepEqual(['MT', '2', 'X', '1'].sort(compareChroms), ['1', '2', 'X', 'MT'])
})
