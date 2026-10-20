// O Mario em pixel art: cada desenho é uma grade de 20 colunas, uma letra por
// pixel ('.' é transparente), virada em SVG com um path de retângulos 1x1 por
// cor. Um contorno claro em volta destaca o Mario sobre o fundo preto.

const PALETTE: Record<string, string> = {
  a: '#131514',
  b: '#99131e',
  c: '#f23b1c',
  d: '#d9cdb5',
  e: '#c08158',
  f: '#45302b',
  g: '#202e53',
  h: '#0072b3',
}

// Cabeça e tronco, iguais em todos os desenhos.
const BODY = [
  '.....aaaaaaaa.......',
  '....abccccccca......',
  '....aaabcccccca.....',
  '...abdbdacccccca....',
  '...adbdbdbccccccaa..',
  '...aaaaadabccccccca.',
  '..abccccccbbccccccca',
  '.accccccccccabccccca',
  '.abbbbbbbbbaaaabccca',
  '....aeeeaaeeeeaaaae.',
  '..aaaeddaadeefafaea.',
  '.adddaddafdddafffdda',
  'addddddddddddafaeeda',
  'aedddddddadddaaddda.',
  '.aeddeaaafddddddaa..',
  '..aaaffffaddddda....',
  '...afffaadddddaa....',
  '....aaaeeeeeeabca...',
  '......aaaaaaaaccca..',
  '.....agabbbagbcccca.',
  '.....ahgcccghbcaccb.',
  '....aghggggghacaccca',
  '....aaehhhhaegcbacca',
  '...adaahhhhaahabaaaa',
  '..addgghhhhhhhhaadda',
  '..addggghhhhhhgdddaa',
  '..addagggghhhgadddda',
  '...aaaagggggggadddda',
]

// Em pé, as duas botas no chão: o passo "fechado" da caminhada.
export const STAND = [
  ...BODY,
  '..affffaaaaaaaaaaaa.',
  '.affffffaa..aaffffaa',
  '.affffffaa..aafffffa',
  '.aaaaaaaaa..aaaaaaaa',
]

// Passo "aberto": a bota da frente avança e a de trás sobe do chão.
export const STRIDE = [
  ...BODY,
  '.afffaa....aaaaaaa..',
  'affffffa...affffffa.',
  'affffffa...aaaaaaaa.',
  'aaaaaaaa............',
]

// Sentado na borda: a perna de trás some e a da frente fica pendurada, mais
// comprida, com a bota já por cima do painel.
export const SIT = [
  ...BODY,
  '...........ahhhha...',
  '...........ahhhha...',
  '...........ahhhha...',
  '...........aaaaaaaa.',
  '............aaffffaa',
  '............aafffffa',
  '............aaaaaaaa',
]

const toPaths = (grid: string[]) => {
  const byColor: Record<string, string[]> = {}
  grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const key = row[x]
      if (key === '.') {
        x++
        continue
      }
      let end = x
      while (end < row.length && row[end] === key) end++
      const color = PALETTE[key]
      byColor[color] = byColor[color] ?? []
      byColor[color].push(`M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  })
  return Object.entries(byColor)
    .map(([color, d]) => `<path fill="${color}" d="${d.join('')}"/>`)
    .join('')
}

// O contorno: a silhueta engordada meio pixel, pintada de claro por baixo.
export const OUTLINE_FILTER =
  `<filter id="o" x="-10%" y="-10%" width="120%" height="120%">` +
  `<feMorphology in="SourceAlpha" operator="dilate" radius="0.7" result="d"/>` +
  `<feFlood flood-color="#f2f5f3"/><feComposite in2="d" operator="in"/>` +
  `<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`

// Um desenho dentro de outro SVG, em (x, y), com a largura pedida e a altura
// na proporção da grade. O filtro "o" precisa estar nas defs do SVG de fora.
export const sprite = (grid: string[], x: number, y: number, width: number, attrs = '') => {
  const rows = grid.length
  const height = (width * (rows + 2)) / 22
  return (
    `<svg x="${x}" y="${y}" width="${width}" height="${height.toFixed(2)}" viewBox="-1 -1 22 ${rows + 2}" ` +
    `shape-rendering="crispEdges"${attrs}><g filter="url(#o)">${toPaths(grid)}</g></svg>`
  )
}

// Altura em pixels de um desenho na largura dada.
export const spriteHeight = (grid: string[], width: number) => (width * (grid.length + 2)) / 22
