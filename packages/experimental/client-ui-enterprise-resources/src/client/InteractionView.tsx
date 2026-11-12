/** Public agent results stay in the normal persisted conversation history. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, FormError, LoadingState } from './common.tsx'
import { workbenchProducts, type MarketJob } from './product-api.ts'
import { NS } from './locales.ts'
import css from './Product.module.css'

type InteractionProps = PropsRuntime<'conversation.chat.commandview'> & PropsLocale<typeof NS>
type RecordData = { kind: 'agent'; jobId: string } | { kind: 'knowledge'; title: string; input: string; answer: string }
function decode(input: string | null): RecordData | undefined {
  if (input === null) return undefined
  let value: unknown
  try { value = JSON.parse(input) } catch { return undefined }
  if (typeof value !== 'object' || value === null || !('kind' in value)) return undefined
  if (value.kind === 'agent' && 'jobId' in value && typeof value.jobId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/u.test(value.jobId)) return { kind: 'agent', jobId: value.jobId }
  if (value.kind === 'knowledge' && 'title' in value && typeof value.title === 'string' && 'input' in value && typeof value.input === 'string' && 'answer' in value && typeof value.answer === 'string') return { kind: 'knowledge', title: value.title, input: value.input, answer: value.answer }
  return undefined
}

/**
 * Render an admitted task or library answer from its durable command reference.
 * @param props - persisted command and locale.
 * @returns conversation result.
 */
export function InteractionView({ node, t }: InteractionProps): ReactNode {
  const record = decode(node.args)
  const jobId = record?.kind === 'agent' ? record.jobId : undefined
  const accepted = node.outcome?.kind === 'success'
  const labels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
      toolbarLabels: { codeLabel: t('markdown.code'), wrapLabel: t('markdown.wrap'), unwrapLabel: t('markdown.unwrap') },
    },
    footnotes: t('markdown.footnotes'),
  }), [t])
  const [job, setJob] = useState<MarketJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const seenState = useRef<string | undefined>()
  useEffect(() => {
    if (!jobId || !accepted) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (): Promise<void> => {
      try {
        const next = await workbenchProducts.job(jobId)
        if (!active) return
        setJob(next); setError(null)
        if (seenState.current !== next.state) {
          seenState.current = next.state
          window.dispatchEvent(new Event('dsh-enterprise-access-changed'))
        }
        if (next.state === 'queued' || next.state === 'running') timer = setTimeout(() => { void load() }, 3000)
      } catch (caught) { if (active) setError(describeError(caught, t, 'error.load')) }
    }
    void load()
    return () => { active = false; clearTimeout(timer) }
  }, [jobId, accepted, retry, t])
  if (!record || node.outcome?.kind === 'error') return <FormError message={t('mention.recordFailed')} />
  const title = record.kind === 'knowledge' ? record.title : job?.title ?? t('mention.agents')
  return <article className={css.interaction} data-enterprise-interaction={record.kind}>
    <header><h2>@{title}</h2>{job ? <span role="status" className={css.status} data-state={job.state}>{t(`market.${job.state}`)}</span> : null}</header>
    {record.kind === 'knowledge' ? <><p className={css.interactionInput}>{record.input}</p><div className={css.interactionMarkdown}><MarkdownText text={record.answer} labels={labels} /></div></>
      : job ? <><p className={css.interactionInput}>{job.input}</p>
        {job.result ? <div className={css.interactionMarkdown}><MarkdownText text={job.result} labels={labels} /></div> : null}
        {job.error ? <FormError message={job.error} /> : null}
        <footer>{job.state === 'completed' && job.artifact ? <a className={css.download} href={workbenchProducts.download(job.id)}>{t('market.download')}</a> : null}</footer>
      </> : !error ? <LoadingState label={t('common.loading')} /> : null}
    {error ? <div className={css.interactionError}><FormError message={error} /><Button size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('common.retry')}</Button></div> : null}
  </article>
}
