export type AppEventMap = {
  WINDOW_RESIZED: { width: number; height: number };
  ZOOM_CHANGED: { zoomLevel: number };
  REFRESH_TICK: { tick: number; refreshRateHz: number };
  REQUEST_PLAY: { trackId: string };
  PLAYBACK_CHANGED: { trackId: string | null; isPlaying: boolean };
  ADD_TO_QUEUE: { trackId: string };
  REMOVE_FROM_QUEUE: { trackId: string };
};

type EventKey = keyof AppEventMap;
type EventHandler<K extends EventKey> = (payload: AppEventMap[K]) => void;

export interface AppEventBus {
  emit<K extends EventKey>(event: K, payload: AppEventMap[K]): void;
  subscribe<K extends EventKey>(event: K, handler: EventHandler<K>): () => void;
}

export function createAppEventBus(): AppEventBus {
  const listeners = new Map<EventKey, Set<(payload: unknown) => void>>();

  return {
    emit(event, payload) {
      const handlers = listeners.get(event);
      if (!handlers || handlers.size === 0) return;
      handlers.forEach((handler) => handler(payload));
    },
    subscribe(event, handler) {
      let handlers = listeners.get(event);
      if (!handlers) {
        handlers = new Set();
        listeners.set(event, handlers);
      }

      const wrapped = (payload: unknown) => {
        handler(payload as AppEventMap[typeof event]);
      };
      handlers.add(wrapped);

      return () => {
        const current = listeners.get(event);
        if (!current) return;
        current.delete(wrapped);
        if (current.size === 0) {
          listeners.delete(event);
        }
      };
    }
  };
}
