// src/export.js — save the current scene as SVG or PNG.
function serialize(svgEl) {
  const clone = svgEl.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', svgEl.clientWidth)
  clone.setAttribute('height', svgEl.clientHeight)
  clone.setAttribute('viewBox', `0 0 ${svgEl.clientWidth} ${svgEl.clientHeight}`)
  return new XMLSerializer().serializeToString(clone)
}

function download(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function exportSvg(svgEl, basename) {
  download(new Blob([serialize(svgEl)], { type: 'image/svg+xml' }), `${basename}.svg`)
}

// One self-contained HTML file: the current view as inline SVG, no dependencies.
export function exportHtml(svgEl, basename) {
  const bg = svgEl.querySelector('rect')?.getAttribute('fill') || '#fff'
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${basename.replace(/[<&]/g, '')}</title>
<style>html,body{margin:0;height:100%;background:${bg}}svg{display:block;width:100%;height:100%}</style></head>
<body>${serialize(svgEl)}</body></html>`
  download(new Blob([html], { type: 'text/html' }), `${basename}.html`)
}

export async function exportPng(svgEl, basename, scale = 3) {
  const url = URL.createObjectURL(new Blob([serialize(svgEl)], { type: 'image/svg+xml' }))
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('could not rasterize the SVG'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = svgEl.clientWidth * scale
  canvas.height = svgEl.clientHeight * scale
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(url)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  download(blob, `${basename}.png`)
}
