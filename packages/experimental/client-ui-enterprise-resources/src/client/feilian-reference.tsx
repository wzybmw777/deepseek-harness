/** User-message chip for a knowledge base reference serialized into the prompt. */

import type { UserTextNodeProps, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import { matchKnowledgeBaseTag } from './feilian-mentions.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** A Feilian knowledge base scoping one user question. */
    feilianKb: { readonly id: string; readonly name: string }
  }
}

/** Recognize the serialized form the `@` source writes at submit time. */
export const feilianKbRule: UserTextRule<'feilianKb'> = {
  id: 'feilianKb',
  order: 35,
  match(text, from) {
    const found = matchKnowledgeBaseTag(text, from)
    return found === undefined ? undefined : { id: 'feilianKb', ...found }
  },
}

/**
 * Render one knowledge base reference as a chip instead of its raw tag.
 * @param props - resolved node and the original text range.
 * @returns the inline chip.
 */
export function FeilianKbReference({ node, raw }: UserTextNodeProps<'feilianKb'>) {
  return <ReferenceChip appearance="skill" label={node.data.name} title={raw} />
}
