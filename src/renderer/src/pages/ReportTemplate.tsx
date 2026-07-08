// The shared report template editor. One template, used for every client's
// PDF — merge fields are inserted via toolbar buttons (never typed), so a
// user can't produce a template with a typo'd/broken placeholder.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { MergeField, MergeFieldBlock, FIELD_LABELS } from '../reports/MergeFieldNode'
import { api } from '../api'

const INLINE_FIELDS = ['client_name', 'date_range', 'generated_date'] as const

export function ReportTemplate(): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const editor = useEditor({
    extensions: [StarterKit, MergeField, MergeFieldBlock],
    content: '',
    onUpdate: () => setSaved(false)
  })

  useEffect(() => {
    let active = true
    api.getReportTemplate().then((html) => {
      if (active && editor) {
        editor.commands.setContent(html)
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
    // Re-run once the editor instance exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  async function save(): Promise<void> {
    if (!editor) return
    setSaving(true)
    try {
      await api.saveReportTemplate(editor.getHTML())
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  function insertInline(fieldKey: string): void {
    editor?.chain().focus().insertContent({ type: 'mergeField', attrs: { fieldKey } }).run()
  }

  function insertSessionsTable(): void {
    editor
      ?.chain()
      .focus()
      .insertContent({ type: 'mergeFieldBlock', attrs: { fieldKey: 'sessions_table' } })
      .run()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-slate-500 hover:text-slate-900">
          ← Reports
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Report template</h1>
        <p className="text-sm text-slate-500">
          One shared template used for every client&apos;s PDF. Insert merge fields with the
          buttons below — they&apos;re filled in automatically when a report is generated.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-2">
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} label="Bold" />
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            label="Italic"
          />
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            label="Heading"
          />
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            label="List"
          />
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {INLINE_FIELDS.map((key) => (
            <ToolbarButton
              key={key}
              onClick={() => insertInline(key)}
              label={`+ ${FIELD_LABELS[key]}`}
              variant="field"
            />
          ))}
          <ToolbarButton
            onClick={insertSessionsTable}
            label={`+ ${FIELD_LABELS.sessions_table}`}
            variant="field"
          />
        </div>
        <div className="min-h-[400px] px-4 py-3">
          {loading ? (
            <p className="text-slate-500">Loading…</p>
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || loading}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save template'}
        </button>
        {saved && <span className="text-sm text-emerald-600">Saved</span>}
      </div>
    </div>
  )
}

function ToolbarButton({
  onClick,
  label,
  variant = 'default'
}: {
  onClick: () => void
  label: string
  variant?: 'default' | 'field'
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        variant === 'field'
          ? 'rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100'
          : 'rounded px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100'
      }
    >
      {label}
    </button>
  )
}
