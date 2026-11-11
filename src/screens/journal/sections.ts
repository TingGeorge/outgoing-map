import { isRouteGap } from '../../core'
import type { Route, RoutePoint } from '../../types'

export function routeSections(route: Route): RoutePoint[][] {
  const sections: RoutePoint[][] = []

  for (const [i, p] of route.points.entries()) {
    const prev = route.points[i - 1]

    if (prev && isRouteGap(prev, p)) sections.push([p])
    else if (sections.length) sections.at(-1)!.push(p)
    else sections.push([p])
  }

  return sections
}
