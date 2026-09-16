// A deliberately small reader format: paragraphs and HTTPS Markdown links.
// No raw HTML, images, embeds or arbitrary Markdown execution.
export function briefSummary(stories: number, headlines: number) {
  return `${stories} deeper read${stories === 1 ? '' : 's'}${headlines ? ` / ${headlines} elsewhere` : ''}`
}

export function newsParagraphs(body: unknown) {
  return String(body || '').split(/\n\s*\n/).filter(p => p.trim()).map(paragraph => {
    const parts: {text:string;href?:string}[] = [], pattern = /(?<!!)\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g
    let end = 0
    for (const match of paragraph.matchAll(pattern)) {
      let url
      try { url = new URL(match[2]) } catch { continue }
      if (url.protocol !== 'https:' || url.username || url.password) continue
      if (match.index > end) parts.push({ text: paragraph.slice(end, match.index) })
      parts.push({ text: match[1], href: url.href })
      end = match.index + match[0].length
    }
    if (end < paragraph.length) parts.push({ text: paragraph.slice(end) })
    return parts
  })
}
