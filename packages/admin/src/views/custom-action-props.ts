/** Props passed to an action dialog component registered in `<Admin components>`. */
export interface CustomActionProps {
  /** The action key from config. */
  actionKey: string
  /** The action label. */
  label: string
  /** ID of the document being acted upon (row or document scope). */
  id?: number | string
  /** IDs of the selected documents (bulk scope). */
  ids?: Array<number | string>
  /** The document or row data. */
  doc?: Record<string, unknown>
  /** Closes the action dialog. */
  close: () => void
}
