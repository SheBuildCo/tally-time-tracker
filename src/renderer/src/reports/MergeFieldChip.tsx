import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { FIELD_LABELS } from './MergeFieldNode'

export function MergeFieldChip({ node }: NodeViewProps): React.JSX.Element {
  const fieldKey = node.attrs.fieldKey as string
  const label = FIELD_LABELS[fieldKey] ?? fieldKey
  const isBlock = node.type.name === 'mergeFieldBlock'

  return (
    <NodeViewWrapper as={isBlock ? 'div' : 'span'} className={isBlock ? 'my-2 block' : 'inline'}>
      <span
        contentEditable={false}
        className={
          isBlock
            ? 'block rounded-md border-2 border-dashed border-indigo-300 bg-indigo-50 px-3 py-2 text-center text-sm font-medium text-indigo-700'
            : 'rounded bg-indigo-100 px-1.5 py-0.5 text-sm font-medium text-indigo-700'
        }
      >
        [{label}]
      </span>
    </NodeViewWrapper>
  )
}
