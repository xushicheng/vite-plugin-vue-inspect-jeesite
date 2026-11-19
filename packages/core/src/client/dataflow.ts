import type { ComponentInternalInstance } from 'vue'
import inspectorOptions from 'virtual:vue-inspector-options'
import { ref } from 'vue'
import { findTraceFromVNode } from './record'

const KEY_IGNORE = 'data-v-inspector-ignore'
const OPEN_HANDLER_KEY = '__VUE_INSPECTOR_OPEN_IN_EDITOR__'
const PANEL_ID = 'vue-inspector-dataflow-panel'
const STYLE_ID = 'vue-inspector-dataflow-style'

// 框架层组件（core/ui 包与 node_modules）不算业务数据定义处
const FRAMEWORK_RE = /node_modules|\/packages\/(core|ui)\//

interface ChainItem {
  uid: number
  name: string
  file: string
  line: number
  column: number
  framework: boolean
  instance: ComponentInternalInstance
}

interface SchemaAnchor {
  target: object
  field: string
  label: string
  component: string
}

interface FlowOwner {
  name: string
  file: string
  keyName: string
  exact: boolean
}

/** 数据流拾取模式：开启后下一次点击任意元素弹出数据流面板 */
export const dataFlowPickActive = ref(false)

let panelEl: HTMLElement | undefined

function unwrapFlowValue(value: unknown): unknown {
  if (value && (value as any).__v_isRef) value = (value as any).value
  if (value && (value as any).__v_raw) value = (value as any).__v_raw
  return value
}

function isSameFlowObject(a: unknown, b: unknown): boolean {
  return unwrapFlowValue(a) === unwrapFlowValue(b)
}

// 在实例可达状态（setupState/props/data，含一层嵌套如 formConfig.schemas）里按引用查找目标对象所在数组
function findFlowKey(instance: ComponentInternalInstance, target: object): string | null {
  const sources: unknown[] = [instance.setupState, instance.props, instance.data]
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    let keys: string[]
    try {
      keys = Object.keys(source as object)
    } catch {
      continue
    }
    for (const key of keys) {
      if (key.startsWith('__')) continue
      let value: unknown
      try {
        value = unwrapFlowValue((source as any)[key])
      } catch {
        continue
      }
      if (Array.isArray(value)) {
        if (value.some((item) => isSameFlowObject(item, target))) return key
      } else if (value && typeof value === 'object' && (value as any).constructor === Object) {
        let subKeys: string[]
        try {
          subKeys = Object.keys(value as object)
        } catch {
          continue
        }
        if (subKeys.length > 50) continue
        for (const subKey of subKeys) {
          let sub: unknown
          try {
            sub = unwrapFlowValue((value as any)[subKey])
          } catch {
            continue
          }
          if (Array.isArray(sub) && sub.some((item) => isSameFlowObject(item, target)))
            return `${key}.${subKey}`
        }
      }
    }
  }
  return null
}

function findVueInstance(el: Element): ComponentInternalInstance | undefined {
  let node: Element | null = el
  let depth = 0
  while (node && depth++ < 50) {
    const instance = (node as any).__vueParentComponent as ComponentInternalInstance | undefined
    if (instance) return instance
    node = node.parentElement
  }
  return undefined
}

// 组件模板根位置：取 subTree 上记录的 vnode 位置（source 与 __file 不一致时退到文件首行）
function getInstancePosition(
  instance: ComponentInternalInstance,
  file: string,
): { line: number; column: number } {
  const subTree: any = instance.subTree
  const candidates: any[] = [
    subTree,
    Array.isArray(subTree?.children) ? subTree.children[0] : undefined,
  ]
  for (const vnode of candidates) {
    const pos = findTraceFromVNode(vnode)?.pos
    if (pos && (!file || pos[0] === file)) return { line: pos[1], column: pos[2] }
  }
  return { line: 1, column: 1 }
}

function buildFlowChain(start: ComponentInternalInstance): ChainItem[] {
  const items: ChainItem[] = []
  let inst: ComponentInternalInstance | null = start
  let depth = 0
  while (inst && depth++ < 40) {
    const type: any = inst.type || {}
    const name =
      type.name || type.__name || (typeof type === 'object' ? '(匿名组件)' : String(type))
    const file: string = type.__file || ''
    const { line, column } = getInstancePosition(inst, file)
    items.push({
      uid: inst.uid,
      name,
      file,
      line,
      column,
      framework: !file || FRAMEWORK_RE.test(file),
      instance: inst,
    })
    inst = inst.parent
  }
  return items
}

function shortFileName(file: string): string {
  if (!file) return ''
  const parts = file.split('/')
  return parts.slice(-2).join('/')
}

function openInEditor(file: string, line: number, column: number): void {
  const target = `${file}:${line}:${column}`
  const devtoolsOpen = (window as any)[OPEN_HANDLER_KEY] as
    | ((file: string) => unknown)
    | undefined
  if (devtoolsOpen) {
    devtoolsOpen(target)
    return
  }
  const url = new URL(
    `${inspectorOptions.base}__open-in-editor?file=${encodeURIComponent(target)}`,
    import.meta.url,
  )
  void fetch(url, { mode: 'no-cors' })
}

// 按 schema 文案反查定义行号（服务端 __inspector-locate 中间件：label/title 形式优先于裸文本）
function locateLine(file: string, text: string): Promise<number | undefined> {
  const url = new URL(
    `${inspectorOptions.base}__inspector-locate?file=${encodeURIComponent(file)}&text=${encodeURIComponent(text)}`,
    import.meta.url,
  )
  return fetch(url)
    .then((response) => response.json())
    .then((data: any) => data?.lines?.[0]?.line as number | undefined)
    .catch(() => undefined)
}

function openWithLocate(
  file: string,
  line: number,
  column: number,
  text: string | undefined,
): void {
  if (!text) {
    openInEditor(file, line, column)
    return
  }
  void locateLine(file, text).then((hit) => {
    openInEditor(file, hit ?? line, hit ? 1 : column)
  })
}

function injectDataFlowStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
#${PANEL_ID} {
  position: fixed;
  z-index: 2147483647;
  width: 390px;
  max-height: 46vh;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 10px;
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.95);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.22);
  font-family: Arial, Helvetica, sans-serif;
  font-size: 13px;
  line-height: 1.4;
}
#${PANEL_ID} .df-title { font-weight: 600; }
#${PANEL_ID} .df-owner { color: #7ee2b8; font-weight: 600; }
#${PANEL_ID} .df-owner.is-guess { color: #fbbf24; }
#${PANEL_ID} .df-rows { overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
#${PANEL_ID} .df-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}
#${PANEL_ID} .df-row:hover { background: rgba(255, 255, 255, 0.14); }
#${PANEL_ID} .df-row.is-framework .df-name,
#${PANEL_ID} .df-row.is-framework .df-file { color: rgba(226, 232, 240, 0.5); }
#${PANEL_ID} .df-row.is-owner { background: rgba(66, 184, 131, 0.2); }
#${PANEL_ID} .df-file {
  color: rgba(226, 232, 240, 0.7);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${PANEL_ID} .df-tip { opacity: 0.7; font-size: 11px; }`
  document.head.appendChild(style)
}

export function closeDataFlowPanel(): void {
  panelEl?.remove()
  panelEl = undefined
}

function renderPanel(
  items: ChainItem[],
  schema: SchemaAnchor | undefined,
  owner: FlowOwner | null,
  x: number,
  y: number,
): void {
  closeDataFlowPanel()
  injectDataFlowStyle()

  const panel = document.createElement('div')
  panel.id = PANEL_ID
  panel.setAttribute(KEY_IGNORE, 'true')

  const title = document.createElement('div')
  title.className = 'df-title'
  title.textContent = '数据流检查 · Esc 关闭'
  panel.appendChild(title)

  if (schema) {
    const schemaEl = document.createElement('div')
    const label = schema.label || schema.field || '—'
    const field = schema.field ? `（field: ${schema.field}）` : ''
    const comp = schema.component ? ` · ${schema.component}` : ''
    schemaEl.textContent = `字段：${label}${field}${comp}`
    panel.appendChild(schemaEl)
  }

  if (owner) {
    const ownerEl = document.createElement('div')
    ownerEl.className = `df-owner${owner.exact ? '' : ' is-guess'}`
    const kind = owner.exact ? '数据定义处' : '推断定义处'
    const key = owner.keyName ? ` · ${owner.keyName}` : ''
    ownerEl.textContent = `${kind}：${shortFileName(owner.file)}${key}`
    ownerEl.title = owner.file
    panel.appendChild(ownerEl)
  }

  const rows = document.createElement('div')
  rows.className = 'df-rows'
  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'df-row'
    if (item.framework) row.classList.add('is-framework')
    const isOwnerRow = Boolean(owner) && item.file === owner!.file && item.name === owner!.name
    if (isOwnerRow) row.classList.add('is-owner')

    const name = document.createElement('span')
    name.className = 'df-name'
    name.textContent = item.name
    const file = document.createElement('span')
    file.className = 'df-file'
    file.textContent = shortFileName(item.file) || '—'

    row.append(name, file)
    row.title = item.file || item.name

    // 数据定义处行：按 schema 文案反查定义行号，面板上预展示目标行
    const locateText = isOwnerRow ? schema?.label || schema?.field : undefined
    if (locateText) {
      void locateLine(item.file, locateText).then((hitLine) => {
        if (hitLine && panelEl === panel) file.textContent += ` → :${hitLine}`
      })
    }
    row.addEventListener('click', () =>
      openWithLocate(item.file, item.line, item.column, locateText),
    )
    rows.appendChild(row)
  }
  panel.appendChild(rows)

  const tip = document.createElement('div')
  tip.className = 'df-tip'
  tip.textContent = '点击条目在 IDE 中打开（组件模板根行号）'
  panel.appendChild(tip)

  document.body.appendChild(panel)
  panelEl = panel

  const margin = 12
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  panel.style.left = `${Math.max(margin, Math.min(x + margin, window.innerWidth - width - margin))}px`
  panel.style.top = `${Math.max(margin, Math.min(y + margin, window.innerHeight - height - margin))}px`
}

/** 从任意元素出发打开数据流面板（可在控制台 window.__VUE_INSPECTOR__.openDataFlow(el) 直接调用） */
export function openDataFlow(el: Element, x = 200, y = 200): void {
  const inst = findVueInstance(el)
  if (!inst) {
    console.warn('[Vue Inspector] 未找到 Vue 组件实例')
    return
  }

  const items = buildFlowChain(inst)

  // schema 锚点：链上最近一个带 schema prop 的字段组件（JeeSiteFormItem）
  let schema: SchemaAnchor | undefined
  for (const item of items.slice(0, 8)) {
    const candidate = (item.instance.props as any)?.schema
    if (candidate && typeof candidate === 'object') {
      schema = {
        target: candidate,
        field: candidate.field ?? '',
        label: candidate.label ?? candidate.title ?? '',
        component: candidate.component ?? '',
      }
      break
    }
  }

  // 数据定义处：最近一个非框架祖先按引用持有 schema（或含它的数组）；找不到则退而取最近业务组件
  let owner: FlowOwner | null = null
  if (schema) {
    for (const item of items) {
      if (item.framework) continue
      const keyName = findFlowKey(item.instance, schema.target)
      if (keyName) {
        owner = { name: item.name, file: item.file, keyName, exact: true }
        break
      }
    }
    if (!owner) {
      const first = items.find((item) => !item.framework)
      if (first)
        owner = {
          name: first.name,
          file: first.file,
          keyName: schema.field ? `field: ${schema.field}` : '',
          exact: false,
        }
    }
  }

  renderPanel(items, schema, owner, x, y)
}

/** 切换拾取模式；返回切换后的状态 */
export function toggleDataFlowPick(): boolean {
  closeDataFlowPanel()
  dataFlowPickActive.value = !dataFlowPickActive.value
  return dataFlowPickActive.value
}

if (typeof window !== 'undefined') {
  // window 捕获阶段先于 inspector 自身的 document 捕获监听，拾取模式下抢占点击
  window.addEventListener(
    'click',
    (event) => {
      if (!dataFlowPickActive.value) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(`[${KEY_IGNORE}]`)) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      dataFlowPickActive.value = false
      openDataFlow(target, event.clientX, event.clientY)
    },
    true,
  )

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return
      dataFlowPickActive.value = false
      closeDataFlowPanel()
    },
    true,
  )

  document.addEventListener(
    'mousedown',
    (event) => {
      if (!panelEl) return
      const target = event.target
      if (
        target instanceof Element &&
        (panelEl.contains(target) || target.closest(`[${KEY_IGNORE}]`))
      )
        return
      closeDataFlowPanel()
    },
    true,
  )
}
