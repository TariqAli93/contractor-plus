/** One label/value pair in a `PropertyGrid`. Lives outside the SFC because a
 *  `<script setup>` block cannot export types. */
export interface PropertyRow {
  key: string;
  label: string;
  /** Plain text. Ignored when a `#<key>` slot is provided for this row. */
  value?: string | number | null;
  /** Money, counts, dates - anything that should align digit-for-digit. */
  tabular?: boolean;
}
