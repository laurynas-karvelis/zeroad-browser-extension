import { jsx } from "hono/jsx"
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  CirclePause,
  CirclePlay,
  Flag,
  Globe,
  type IconNode,
  LayoutDashboard,
  RotateCw,
  Settings,
} from "lucide"

// Lucide (https://lucide.dev, ISC) inlined as SVG. Sized to 1em so the font-size utilities control the
// icon size, and stroked with currentColor so it takes the colour of the text around it.
const ICONS = {
  "arrow-right": ArrowRight,
  check: Check,
  "circle-alert": CircleAlert,
  "chevron-down": ChevronDown,
  "circle-help": CircleHelp,
  flag: Flag,
  globe: Globe,
  "circle-pause": CirclePause,
  "circle-play": CirclePlay,
  "layout-dashboard": LayoutDashboard,
  "rotate-cw": RotateCw,
  settings: Settings,
} satisfies Record<string, IconNode>

export type IconName = keyof typeof ICONS

export function Icon(props: { name: IconName; class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      style="vertical-align:-0.125em"
      aria-hidden="true"
    >
      {ICONS[props.name].map(([tag, attributes]) => jsx(tag, attributes))}
    </svg>
  )
}
