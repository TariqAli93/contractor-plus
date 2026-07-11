// Delimited-text interchange for the data grid. Two dialects share one parser:
//   - TSV (tab) is what Excel / Google Sheets put on the CLIPBOARD as
//     text/plain - used by in-grid copy/paste.
//   - CSV (comma) is the on-disk export/import format Excel opens directly.
// A cell containing the delimiter, a newline, or a quote is wrapped in double
// quotes with embedded quotes doubled - the dialect Excel reads back.

export type TsvMatrix = string[][];

function parseDelimited(text: string, delim: string): TsvMatrix {
  // Normalise line endings and drop the single trailing newline Excel appends.
  const normalised = text.replace(/\r\n?/g, '\n');
  const body = normalised.endsWith('\n') ? normalised.slice(0, -1) : normalised;
  if (body === '') return [];

  const rows: TsvMatrix = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function stringifyDelimited(matrix: TsvMatrix, delim: string): string {
  const special = new RegExp(`[${delim === '\t' ? '\\t' : delim}\\n"]`);
  return matrix
    .map((row) =>
      row.map((cell) => (special.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(delim),
    )
    .join('\n');
}

/** Parse clipboard text (Excel TSV dialect) into a row-major matrix. */
export const parseTsv = (text: string): TsvMatrix => parseDelimited(text, '\t');
/** Serialise a matrix to clipboard text Excel can paste. */
export const stringifyTsv = (matrix: TsvMatrix): string => stringifyDelimited(matrix, '\t');
/** Parse a .csv file's text into a row-major matrix. */
export const parseCsv = (text: string): TsvMatrix => parseDelimited(text, ',');
/** Serialise a matrix to .csv text. */
export const stringifyCsv = (matrix: TsvMatrix): string => stringifyDelimited(matrix, ',');
