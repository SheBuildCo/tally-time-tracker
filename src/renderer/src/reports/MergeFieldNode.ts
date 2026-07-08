// Merge fields are atomic, non-editable TipTap nodes inserted via a toolbar
// button — never typed template syntax a user could mistype. Two node types:
// `mergeField` (inline chip: client name, date range, generated date) and
// `mergeFieldBlock` (the sessions table — doesn't make sense as an inline
// chip). Both round-trip through the exact `[data-merge-field]` HTML shape
// that `substituteMergeFields` in the main process looks for.

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MergeFieldChip } from './MergeFieldChip'

export const FIELD_LABELS: Record<string, string> = {
  client_name: 'Client Name',
  date_range: 'Date Range',
  generated_date: 'Generated Date',
  sessions_table: 'Sessions Table'
}

export const MergeField = Node.create({
  name: 'mergeField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      fieldKey: { default: null }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-merge-field]',
        getAttrs: (el) => ({
          fieldKey: (el as HTMLElement).getAttribute('data-merge-field')
        })
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const fieldKey = node.attrs.fieldKey as string
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-merge-field': fieldKey,
        contenteditable: 'false'
      }),
      `[${FIELD_LABELS[fieldKey] ?? fieldKey}]`
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MergeFieldChip)
  }
})

export const MergeFieldBlock = Node.create({
  name: 'mergeFieldBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      fieldKey: { default: 'sessions_table' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-merge-field]',
        getAttrs: (el) => ({
          fieldKey: (el as HTMLElement).getAttribute('data-merge-field')
        })
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const fieldKey = node.attrs.fieldKey as string
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-merge-field': fieldKey,
        contenteditable: 'false'
      }),
      `[${FIELD_LABELS[fieldKey] ?? fieldKey}]`
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MergeFieldChip)
  }
})
