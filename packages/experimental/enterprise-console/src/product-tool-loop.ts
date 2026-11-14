/** Bounded function-calling loop shared by text product runs. */

import type { FeilianToolDefinition } from './feilian-tools.ts'
import type { ChannelWireProtocol } from './types.ts'

/** One model request dispatcher owned by the product runtime. */
export interface ToolLoopTransport {
  /** @param body - provider request body. @returns its parsed JSON response. */
  send(body: Record<string, unknown>): Promise<unknown>
}

/** Everything one text product run needs to answer with tools. */
export interface ToolLoopOptions {
  readonly protocol: ChannelWireProtocol
  readonly modelName: string
  readonly system: string
  readonly userInput: string
  readonly maxTokens: number
  readonly tools: readonly FeilianToolDefinition[]
  readonly transport: ToolLoopTransport
  readonly executeTool: (name: string, input: Readonly<Record<string, unknown>>) => Promise<string>
  /** Observe each model round; progress reporting must never alter the exchange. */
  readonly onRound?: (round: number) => void
  /** Observe each tool call before it runs. */
  readonly onTool?: (name: string, input: Readonly<Record<string, unknown>>) => void
}

/** Model requests per run, including the first one and the closing no-tool turn. */
const MAX_TOOL_ROUNDS = 4
/** Closing instruction once the tool budget is spent. */
const FINAL_INSTRUCTION = '请基于已获得的材料直接给出最终回答，不要再调用工具。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

interface ParsedCall {
  readonly id: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}

async function callTool(options: ToolLoopOptions, name: string, input: Readonly<Record<string, unknown>>): Promise<string> {
  try { return await options.executeTool(name, input) } catch (error) {
    return `工具执行失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function observe(run: (() => void) | undefined): void {
  try { run?.() } catch { /* Progress reporting is advisory. */ }
}

function argumentsOf(value: unknown): Readonly<Record<string, unknown>> {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return {}
  try { const parsed: unknown = JSON.parse(value); return isRecord(parsed) ? parsed : {} } catch { return {} }
}

/**
 * Answer one text product run, letting the model call the offered tools first.
 * @param options - protocol, prompt, tool definitions, and transport.
 * @returns the final assistant text.
 */
export async function runTextWithTools(options: ToolLoopOptions): Promise<string> {
  if (options.protocol === 'openai-chat') return runOpenAiChat(options)
  if (options.protocol === 'openai-responses') return runOpenAiResponses(options)
  return runAnthropicMessages(options)
}

function openAiChatTools(options: ToolLoopOptions): Record<string, unknown>[] {
  return options.tools.map(tool => ({
    type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

async function runOpenAiChat(options: ToolLoopOptions): Promise<string> {
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.userInput },
  ]
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    observe(() => options.onRound?.(round))
    const response = await options.transport.send({
      model: options.modelName, messages, stream: false, max_tokens: options.maxTokens,
      tools: openAiChatTools(options), tool_choice: 'auto',
    })
    const choice: unknown = isRecord(response) && Array.isArray(response.choices) ? response.choices[0] : undefined
    const message = isRecord(choice) && isRecord(choice.message) ? choice.message : {}
    const rawCalls: unknown[] = Array.isArray(message.tool_calls) ? message.tool_calls : []
    const calls: ParsedCall[] = rawCalls.filter(isRecord).map((call) => {
      const fn = isRecord(call.function) ? call.function : {}
      return { id: textOf(call.id), name: textOf(fn.name), input: argumentsOf(fn.arguments) }
    })
    if (calls.length === 0) return textOf(message.content)
    messages.push({ ...message, role: 'assistant' })
    for (const call of calls) {
      observe(() => options.onTool?.(call.name, call.input))
      messages.push({ role: 'tool', tool_call_id: call.id, content: await callTool(options, call.name, call.input) })
    }
  }
  messages.push({ role: 'user', content: FINAL_INSTRUCTION })
  observe(() => options.onRound?.(MAX_TOOL_ROUNDS))
  const response = await options.transport.send({
    model: options.modelName, messages, stream: false, max_tokens: options.maxTokens,
  })
  const choice: unknown = isRecord(response) && Array.isArray(response.choices) ? response.choices[0] : undefined
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : {}
  return textOf(message.content)
}

function responsesText(response: unknown, output: readonly unknown[]): string {
  const blocks: string[] = []
  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const block of item.content) {
      if (!isRecord(block)) continue
      if (block.type === 'output_text' || block.type === 'text') blocks.push(textOf(block.text))
    }
  }
  if (blocks.length > 0) return blocks.join('\n')
  return isRecord(response) ? textOf(response.output_text) : ''
}

async function runOpenAiResponses(options: ToolLoopOptions): Promise<string> {
  const input: Record<string, unknown>[] = [{ role: 'user', content: options.userInput }]
  const tools = options.tools.map(tool => ({
    type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters,
  }))
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    observe(() => options.onRound?.(round))
    const response = await options.transport.send({
      model: options.modelName, instructions: options.system, input, stream: false,
      max_output_tokens: options.maxTokens, tools, tool_choice: 'auto',
    })
    const output = isRecord(response) && Array.isArray(response.output) ? response.output : []
    const calls: ParsedCall[] = output.filter(isRecord)
      .filter(item => item.type === 'function_call')
      .map(item => ({ id: textOf(item.call_id), name: textOf(item.name), input: argumentsOf(item.arguments) }))
    if (calls.length === 0) return responsesText(response, output)
    for (const item of output) if (isRecord(item)) input.push(item)
    for (const call of calls) {
      observe(() => options.onTool?.(call.name, call.input))
      input.push({ type: 'function_call_output', call_id: call.id, output: await callTool(options, call.name, call.input) })
    }
  }
  input.push({ role: 'user', content: FINAL_INSTRUCTION })
  observe(() => options.onRound?.(MAX_TOOL_ROUNDS))
  const response = await options.transport.send({
    model: options.modelName, instructions: options.system, input, stream: false, max_output_tokens: options.maxTokens,
  })
  const output = isRecord(response) && Array.isArray(response.output) ? response.output : []
  return responsesText(response, output)
}

function anthropicText(content: readonly unknown[]): string {
  return content.filter(isRecord)
    .filter(block => block.type === 'text')
    .map(block => textOf(block.text))
    .join('\n')
}

async function runAnthropicMessages(options: ToolLoopOptions): Promise<string> {
  const messages: Record<string, unknown>[] = [{ role: 'user', content: options.userInput }]
  const tools = options.tools.map(tool => ({
    name: tool.name, description: tool.description, input_schema: tool.parameters,
  }))
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    observe(() => options.onRound?.(round))
    const response = await options.transport.send({
      model: options.modelName, system: options.system, messages, max_tokens: options.maxTokens,
      stream: false, tools,
    })
    const content = isRecord(response) && Array.isArray(response.content) ? response.content : []
    const calls: ParsedCall[] = content.filter(isRecord)
      .filter(block => block.type === 'tool_use')
      .map(block => ({ id: textOf(block.id), name: textOf(block.name), input: argumentsOf(block.input) }))
    if (calls.length === 0) return anthropicText(content)
    messages.push({ role: 'assistant', content })
    const results: Record<string, unknown>[] = []
    for (const call of calls) {
      observe(() => options.onTool?.(call.name, call.input))
      results.push({ type: 'tool_result', tool_use_id: call.id, content: await callTool(options, call.name, call.input) })
    }
    messages.push({ role: 'user', content: results })
  }
  messages.push({ role: 'user', content: FINAL_INSTRUCTION })
  observe(() => options.onRound?.(MAX_TOOL_ROUNDS))
  const response = await options.transport.send({
    model: options.modelName, system: options.system, messages, max_tokens: options.maxTokens, stream: false,
  })
  const content = isRecord(response) && Array.isArray(response.content) ? response.content : []
  return anthropicText(content)
}
