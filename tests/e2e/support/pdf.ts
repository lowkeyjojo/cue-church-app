// A minimal PDF writer for tests: one 16:9 page per entry, each filled with
// its own background colour (so the output's colour tells which page is up)
// and a line of Helvetica text.

/** Colours are 0–255. */
export function makePdf(pages: { title: string; color: [number, number, number] }[]): Buffer {
  const objects: string[] = []
  const add = (body: string) => {
    objects.push(body)
    return objects.length
  }
  const catalog = add('')
  const tree = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  const kids: number[] = []
  for (const page of pages) {
    const [r, g, b] = page.color.map((c) => (c / 255).toFixed(3))
    const text = page.title.replace(/[()\\]/g, (c) => `\\${c}`)
    const content = [
      `${r} ${g} ${b} rg 0 0 960 540 re f`,
      '1 1 1 rg BT /F1 64 Tf 80 250 Td',
      `(${text}) Tj ET`
    ].join('\n')
    const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
    kids.push(
      add(
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 960 540] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`
      )
    )
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`
  objects[tree - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
