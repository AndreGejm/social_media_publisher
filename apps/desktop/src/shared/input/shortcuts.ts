export type ShortcutActionId =
  | "toggle_play_pause"
  | "next_track"
  | "previous_track"
  | "toggle_mute"
  | "toggle_queue_visibility"
  | "focus_track_search"
  | "move_queue_track_up"
  | "move_queue_track_down";

export type ShortcutBindings = Record<ShortcutActionId, string | null>;

export type ShortcutActionDescriptor = {
  id: ShortcutActionId;
  label: string;
  description: string;
};

export const SHORTCUT_ACTIONS: ShortcutActionDescriptor[] = [
  {
    id: "toggle_play_pause",
    label: "Play / Pause",
    description: "Toggle playback in the shared player."
  },
  {
    id: "next_track",
    label: "Next Track",
    description: "Move to the next track in the active queue."
  },
  {
    id: "previous_track",
    label: "Previous Track",
    description: "Move to the previous track in the active queue."
  },
  {
    id: "toggle_mute",
    label: "Mute / Unmute",
    description: "Toggle shared player volume mute."
  },
  {
    id: "toggle_queue_visibility",
    label: "Queue / Playlist",
    description: "Toggle queue visibility in the shared player."
  },
  {
    id: "focus_track_search",
    label: "Focus Track Search",
    description: "Move keyboard focus to the playlist search input."
  },
  {
    id: "move_queue_track_up",
    label: "Move Queue Up",
    description: "Move selected queue track one position up."
  },
  {
    id: "move_queue_track_down",
    label: "Move Queue Down",
    description: "Move selected queue track one position down."
  }
];

const MODIFIER_PARTS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const MODIFIER_KEY_CODES = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
  toggle_play_pause: "Space",
  next_track: "ArrowRight",
  previous_track: "ArrowLeft",
  toggle_mute: "KeyM",
  toggle_queue_visibility: "KeyQ",
  focus_track_search: "Ctrl+KeyF",
  move_queue_track_up: "Ctrl+ArrowUp",
  move_queue_track_down: "Ctrl+ArrowDown"
};

type ShortcutEventLike = {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

function resolveEventCode(event: ShortcutEventLike): string | null {
  if (event.code && event.code !== "Unidentified") {
    return event.code;
  }
  const key = event.key ?? "";
  if (key === " ") return "Space";
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key.length === 0) return null;
  return key;
}

function canonicalizeShortcutBinding(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const terminal = parts[parts.length - 1];
  if (!terminal || MODIFIER_PARTS.includes(terminal as (typeof MODIFIER_PARTS)[number])) {
    return null;
  }
  if (!/^[A-Za-z0-9]+$/.test(terminal)) {
    return null;
  }

  const seen = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    if (!MODIFIER_PARTS.includes(part as (typeof MODIFIER_PARTS)[number])) {
      return null;
    }
    if (seen.has(part)) return null;
    seen.add(part);
  }

  const orderedModifiers = MODIFIER_PARTS.filter((part) => seen.has(part));
  return [...orderedModifiers, terminal].join("+");
}

export function keyboardEventToShortcutBinding(event: ShortcutEventLike): string | null {
  const code = resolveEventCode(event);
  if (!code || MODIFIER_KEY_CODES.has(code)) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(code);
  return canonicalizeShortcutBinding(parts.join("+"));
}

export function formatShortcutBinding(binding: string | null): string {
  if (!binding) return "Unassigned";
  const parts = binding.split("+");
  const key = parts[parts.length - 1] ?? "";
  const prettyKey = (() => {
    if (key === "Space") return "Space";
    if (key === "ArrowLeft") return "Left Arrow";
    if (key === "ArrowRight") return "Right Arrow";
    if (key === "ArrowUp") return "Up Arrow";
    if (key === "ArrowDown") return "Down Arrow";
    if (key.startsWith("Key") && key.length === 4) return key.slice(3);
    if (key.startsWith("Digit") && key.length === 6) return key.slice(5);
    return key;
  })();
  return [...parts.slice(0, -1), prettyKey].join(" + ");
}

export function findShortcutBindingConflicts(bindings: ShortcutBindings): Set<ShortcutActionId> {
  const bindingToActions = new Map<string, ShortcutActionId[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const binding = canonicalizeShortcutBinding(bindings[action.id]);
    if (!binding) continue;
    const actions = bindingToActions.get(binding) ?? [];
    actions.push(action.id);
    bindingToActions.set(binding, actions);
  }

  const conflicts = new Set<ShortcutActionId>();
  for (const actions of bindingToActions.values()) {
    if (actions.length < 2) continue;
    for (const action of actions) {
      conflicts.add(action);
    }
  }
  return conflicts;
}

export function isShortcutBindings(value: unknown): value is Partial<ShortcutBindings> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  for (const action of SHORTCUT_ACTIONS) {
    if (!(action.id in candidate)) continue;
    const binding = candidate[action.id];
    if (binding !== null && typeof binding !== "string") return false;
  }
  return true;
}

export function sanitizeShortcutBindings(value: unknown): ShortcutBindings {
  if (!isShortcutBindings(value)) return { ...DEFAULT_SHORTCUT_BINDINGS };
  const candidate = value as Partial<ShortcutBindings>;
  const out: ShortcutBindings = { ...DEFAULT_SHORTCUT_BINDINGS };
  for (const action of SHORTCUT_ACTIONS) {
    if (!(action.id in candidate)) continue;
    out[action.id] = canonicalizeShortcutBinding(candidate[action.id] ?? null) ?? null;
  }
  return out;
}
