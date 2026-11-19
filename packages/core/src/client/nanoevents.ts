/**
 * Vendored from nanoevents (MIT) —— 客户端零外部依赖，
 * 保证宿主通过 link: 从 src/ 直接加载 client 模块时无需安装 nanoevents。
 */

export type Emitter<Events extends Record<string, (...args: any[]) => void>> = {
  emit: <K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) => void
  on: <K extends keyof Events>(event: K, cb: Events[K]) => () => void
}

export function createNanoEvents<Events extends Record<string, (...args: any[]) => void>>(): Emitter<Events> {
  const events: { [K in keyof Events]?: Events[K][] } = {}

  return {
    emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) {
      for (const cb of events[event] ?? []) cb(...args)
    },
    on<K extends keyof Events>(event: K, cb: Events[K]) {
      ;(events[event] ||= []).push(cb)
      return () => {
        events[event] = events[event]!.filter((i) => i !== cb)
      }
    },
  }
}
