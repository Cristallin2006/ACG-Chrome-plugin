import { IllustEntry } from './api'

/**
 * Exact-fit binary space partitioning: the tiling-window-manager split logic
 * (i3/bspwm) applied to the illustration wall.
 *
 * Every node carries a linear shape law `w = aspect·h + beta` under which its
 * subtree tiles with zero cropping and zero stretching — including the grout:
 * each tile box is inset by TILE_INSET px on every side to form the seams, and
 * the law is defined so the INSET CONTENT of every leaf lands exactly on its
 * image's aspect ratio.
 *   leaf          aspect = a,  beta = 2·inset·(1 − a)
 *   side by side  aspects add, betas add          (widths add at equal height)
 *   stacked       aspect = harmonic(A1, A2),
 *                 beta = aspect·(β1/A1 + β2/A2)   (heights add at equal width)
 * The tree is built bottom-up with a greedy target aspect per node, then the
 * wall is drawn at the root's shape law (centred inside the viewport — any
 * residual mismatch becomes outer margin, never cropped pixels) and split
 * exactly top-down.
 */

export interface Tile {
  illust: IllustEntry
  x: number
  y: number
  w: number
  h: number
}

interface Node {
  /** Natural aspect of the subtree's shape law. */
  aspect: number
  /** Constant term of the shape law: the grout's contribution to width. */
  beta: number
  /** Accumulated relative distance between targets and achievable aspects. */
  score: number
  illust: IllustEntry | null
  /** 'row' = children side by side (vertical cut), 'col' = stacked. */
  dir: 'row' | 'col' | null
  first: Node | null
  second: Node | null
}

const PAGE_PADDING = 7
/** Per-side inset of the image inside its tile box. Must match
 *  `.kunya-tile { padding }` in main.css; two tiles' insets meet into one
 *  grout line. */
const TILE_INSET = 5
/** How many images may be evicted while hunting for a layout without runts. */
const MAX_DROPS = 6

/** Tiles smaller than this on either edge read as debris, not puzzle pieces.
 *  Scales with the screen: a phone tile may be smaller than a desktop one. */
function minTileEdge(availW: number, availH: number): number {
  const edge = Math.round(Math.min(availW, availH) / 10)
  return Math.min(Math.max(edge, 64), 110)
}

/** How many illustrations earn a tile: sized so a tile stays comfortably
 *  large — the wall is a handful of pieces you actually look at, not a
 *  contact sheet. Capped so a slow ranking fetch never leaves the wall
 *  sparse. */
export function pickTileCount(
  viewportW: number,
  viewportH: number,
  available: number,
): number {
  const byArea = Math.round((viewportW * viewportH) / 85000)
  const clamped = Math.min(Math.max(byArea, 8), 32)
  return Math.min(clamped, available)
}

function harmonic(x: number, y: number): number {
  return (x * y) / (x + y)
}

/** Split index balancing the summed weights of the two halves. */
function bestSplitIndex(weights: number[]): number {
  let total = 0
  for (let i = 0; i < weights.length; i++) total += weights[i]

  let left = 0
  let bestIndex = 1
  let bestScore = -1
  for (let k = 1; k < weights.length; k++) {
    left += weights[k - 1]
    const right = total - left
    const score = Math.min(left, right) / Math.max(left, right)
    if (score > bestScore) {
      bestScore = score
      bestIndex = k
    }
  }
  return bestIndex
}

const BEAM = 4

/**
 * Beam-search tree construction. Both cut directions are tried at every node;
 * the split point balances the group's bulk (sum of aspects for a vertical
 * cut, sum of inverse aspects for a horizontal one), with the root also
 * probing the neighbouring split points. Children are handed target aspects
 * proportional to that bulk. Every node keeps the BEAM best-scoring
 * candidates, so the root can pick a tree whose natural aspect lands close to
 * the screen instead of locking in a bad early cut. The root's own mismatch
 * is weighted by the leaf count: a wall that barely fills the screen is a
 * worse outcome than a few tiles being gently off their ideal share.
 */
function build(
  illusts: IllustEntry[],
  target: number,
  depth: number,
): Node[] {
  if (illusts.length === 1) {
    const a = illusts[0].width / illusts[0].height
    return [
      {
        aspect: a,
        beta: 2 * TILE_INSET * (1 - a),
        score: Math.abs(a - target) / target,
        illust: illusts[0],
        dir: null,
        first: null,
        second: null,
      },
    ]
  }

  const aspects = illusts.map(i => i.width / i.height)
  const rootWeight = depth === 0 ? illusts.length : 1
  const candidates: Node[] = []

  for (let d = 0; d < 2; d++) {
    const dir: 'row' | 'col' = d === 0 ? 'row' : 'col'
    const weights = dir === 'row' ? aspects : aspects.map(a => 1 / a)
    const kBest = bestSplitIndex(weights)
    const ks =
      depth === 0
        ? [kBest - 1, kBest, kBest + 1].filter(k => k >= 1 && k < illusts.length)
        : [kBest]

    for (let ki = 0; ki < ks.length; ki++) {
      const k = ks[ki]
      const g1 = illusts.slice(0, k)
      const g2 = illusts.slice(k)
      let bulk1 = 0
      let bulk2 = 0
      for (let i = 0; i < weights.length; i++) {
        if (i < k) bulk1 += weights[i]
        else bulk2 += weights[i]
      }

      // Hand each child the share of the target aspect its bulk suggests, so
      // deep nodes aim where their images can actually land.
      let t1: number
      let t2: number
      if (dir === 'row') {
        t1 = (target * bulk1) / (bulk1 + bulk2)
        t2 = target - t1
      } else {
        t1 = (target * (bulk1 + bulk2)) / bulk1
        t2 = (target * (bulk1 + bulk2)) / bulk2
      }

      const firsts = build(g1, t1, depth + 1)
      const seconds = build(g2, t2, depth + 1)
      for (let fi = 0; fi < firsts.length; fi++) {
        for (let si = 0; si < seconds.length; si++) {
          const first = firsts[fi]
          const second = seconds[si]
          const aspect =
            dir === 'row'
              ? first.aspect + second.aspect
              : harmonic(first.aspect, second.aspect)
          const beta =
            dir === 'row'
              ? first.beta + second.beta
              : aspect * (first.beta / first.aspect + second.beta / second.aspect)
          candidates.push({
            aspect,
            beta,
            score:
              (rootWeight * Math.abs(aspect - target)) / target +
              first.score +
              second.score,
            illust: null,
            dir,
            first,
            second,
          })
        }
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score)
  return candidates.slice(0, BEAM)
}

function assign(
  node: Node,
  x: number,
  y: number,
  w: number,
  h: number,
  tiles: Tile[],
): void {
  if (node.illust !== null) {
    tiles.push({ illust: node.illust, x, y, w, h })
    return
  }

  const first = node.first as Node
  const second = node.second as Node

  if (node.dir === 'row') {
    const w1 = first.aspect * h + first.beta
    assign(first, x, y, w1, h, tiles)
    assign(second, x + w1, y, w - w1, h, tiles)
  } else {
    const h1 = (w - first.beta) / first.aspect
    assign(first, x, y, w, h1, tiles)
    assign(second, x, y + h1, w, h - h1, tiles)
  }
}

/**
 * Lay out `illusts` as one gapless puzzle. The wall follows the root's shape
 * law at the largest size that fits inside the padded viewport, centred: if
 * the images cannot tile the exact screen shape, the slack shows as a
 * symmetrical outer frame — the pictures themselves are never cropped, and
 * the inset content of every tile keeps the image's exact aspect ratio.
 */
export function computeTiling(
  viewportW: number,
  viewportH: number,
  illusts: IllustEntry[],
): Tile[] {
  if (illusts.length === 0) return []

  const availW = viewportW - PAGE_PADDING * 2
  const availH = viewportH - PAGE_PADDING * 2

  // Some images squeeze a runt tile out of any cut pattern; evicting the
  // runt's own image and re-laying-out almost always finds a wall where
  // every piece is presentable.
  let pool = illusts
  let best: Tile[] | null = null
  let bestEdge = -1
  const minEdge = minTileEdge(availW, availH)
  for (let drops = 0; drops <= MAX_DROPS; drops++) {
    const tiles = layOut(availW, availH, pool)
    let runt: Tile | null = null
    for (let i = 0; i < tiles.length; i++) {
      const edge = Math.min(tiles[i].w, tiles[i].h) - TILE_INSET * 2
      if (runt === null || edge < Math.min(runt.w, runt.h) - TILE_INSET * 2) {
        runt = tiles[i]
      }
    }
    if (runt === null) return tiles
    const runtEdge = Math.min(runt.w, runt.h) - TILE_INSET * 2
    if (runtEdge > bestEdge) {
      bestEdge = runtEdge
      best = tiles
    }
    if (runtEdge >= minEdge) return tiles
    if (pool.length <= 4) break
    pool = pool.filter(p => p.id !== (runt as Tile).illust.id)
  }
  return best as Tile[]
}

function layOut(availW: number, availH: number, illusts: IllustEntry[]): Tile[] {
  const root = build(illusts, availW / availH, 0)[0]

  let w = availW
  let h = (w - root.beta) / root.aspect
  if (h > availH) {
    h = availH
    w = root.aspect * h + root.beta
  }
  const x = PAGE_PADDING + (availW - w) / 2
  const y = PAGE_PADDING + (availH - h) / 2

  const tiles: Tile[] = []
  assign(root, x, y, w, h, tiles)
  return tiles
}
