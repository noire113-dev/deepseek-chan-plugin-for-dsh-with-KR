// Maintainer-only extraction. Parse static dictionaries; never execute compiled app code.
import { parse } from 'acorn'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const packages = join(dirname(here), 'harness/overlay/dsh/node_modules/@deepseek-ai')
const dictionaries = Object.create(null)
let registrations = 0

function children(node) {
  return Object.values(node).flatMap((value) => Array.isArray(value) ? value.filter((item) => item?.type) : value?.type ? [value] : [])
}
function scopeNode(node) { return node.type === 'Program' || node.type === 'BlockStatement' || /Function/.test(node.type) }
for (const entry of await readdir(packages)) {
  const path = join(packages, entry, 'lib/client.js')
  let source
  try { source = await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') continue; throw error }
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  const scopes = new WeakMap()
  function collect(node, stack = []) {
    if (scopeNode(node)) { scopes.set(node, new Map()); stack = [...stack, node] }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') scopes.get(stack.at(-1)).set(node.id.name, node.init)
    for (const child of children(node)) collect(child, stack)
  }
  collect(ast)
  function value(node, stack, seen = new Set()) {
    if (!node) throw new Error('Missing initializer')
    if (node.type === 'Literal') return node.value
    if (node.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked
    if (node.type === 'Identifier') {
      if (seen.has(node.name)) throw new Error('Recursive identifier ' + node.name)
      for (let i = stack.length - 1; i >= 0; i--) {
        const found = scopes.get(stack[i]).get(node.name)
        if (found) return value(found, stack.slice(0, i + 1), new Set([...seen, node.name]))
      }
      throw new Error('Unresolved identifier ' + node.name)
    }
    if (node.type === 'ObjectExpression') {
      const result = Object.create(null)
      for (const prop of node.properties) {
        if (prop.type === 'SpreadElement') { Object.assign(result, value(prop.argument, stack, seen)); continue }
        if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init') throw new Error('Non-static dictionary property')
        result[prop.key.name ?? prop.key.value] = value(prop.value, stack, seen)
      }
      return result
    }
    if (node.type === 'ArrayExpression') return node.elements.map((item) => value(item, stack, seen))
    if (node.type === 'BinaryExpression' && node.operator === '+') return value(node.left, stack, seen) + value(node.right, stack, seen)
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'join') {
      const array = value(node.callee.object, stack, seen)
      if (Array.isArray(array)) return array.join(node.arguments.length ? value(node.arguments[0], stack, seen) : ',')
    }
    throw new Error('Non-static expression ' + source.slice(node.start, Math.min(node.end, node.start + 100)))
  }
  function visit(node, stack = []) {
    if (scopeNode(node)) stack = [...stack, node]
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'register') {
      const receiver = node.callee.object
      const localeCall = receiver.type === 'Identifier' && receiver.name === 'locale' || receiver.type === 'MemberExpression' && receiver.property.name === 'locale'
      if (localeCall && node.arguments[1]?.type === 'ObjectExpression') {
        const zh = node.arguments[1].properties.find((prop) => (prop.key?.name ?? prop.key?.value) === 'zh')
        if (zh) {
          try {
            const ns = value(node.arguments[0], stack)
            const dict = value(zh.value, stack)
            if (dictionaries[ns] && JSON.stringify(dictionaries[ns]) !== JSON.stringify(dict)) throw new Error('Conflicting namespace ' + ns)
            dictionaries[ns] = dict; registrations++
          } catch (error) { throw new Error(`${entry}: ${error.message}`, { cause: error }) }
        }
      }
    }
    for (const child of children(node)) visit(child, stack)
  }
  visit(ast)
}
if (!registrations) throw new Error('No Korean dictionaries found')
await writeFile(join(here, 'locales.ko.json'), JSON.stringify(dictionaries, null, 2) + '\n')
console.log(`Extracted ${registrations} registrations (${Object.keys(dictionaries).length} namespaces) without executing app code.`)
