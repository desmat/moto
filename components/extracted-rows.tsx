'use client'
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// The reusable "review extracted rows" table (S10 schedule items; S11 receipt line
// items and S13 proposed logs parameterize the same component). Deliberately dumb and
// fully controlled: renders an editable cell per column, per-row delete, and an add-row
// button; the only smarts are numeric coercion for number columns. Validation and
// persistence belong to the caller.

export type ExtractedRowsColumn = {
  label: string,
  field: string,
  type: "text" | "number" | "select",
  options?: string[],   // for type "select"
  width?: string,       // optional CSS width (e.g. "6rem") for the column
};

export default function ExtractedRows({ columns, rows, onChange }: {
  columns: ExtractedRowsColumn[],
  rows: any[],
  onChange: (rows: any[]) => void,
}) {
  const setCell = (rowIndex: number, field: string, raw: string, type: ExtractedRowsColumn["type"]) => {
    const value = type == "number"
      ? (raw == "" ? undefined : Number(raw))
      : raw;
    onChange(rows.map((row, i) => i == rowIndex ? { ...row, [field]: value } : row));
  };

  const deleteRow = (rowIndex: number) => {
    onChange(rows.filter((_, i) => i != rowIndex));
  };

  const addRow = () => {
    onChange([...rows, {}]);
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.field}
                  className="px-1 pb-1 text-left font-medium text-muted-foreground"
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column.field} className="p-1 align-top">
                    {column.type == "select"
                      ? <select
                          aria-label={column.label}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm"
                          value={row[column.field] ?? ""}
                          onChange={(e) => setCell(rowIndex, column.field, e.target.value, column.type)}
                        >
                          <option value="" disabled hidden />
                          {(column.options || []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      : <Input
                          aria-label={column.label}
                          type={column.type}
                          value={row[column.field] ?? ""}
                          onChange={(e) => setCell(rowIndex, column.field, e.target.value, column.type)}
                        />
                    }
                  </td>
                ))}
                <td className="p-1 align-middle">
                  <button
                    type="button"
                    aria-label={`Delete row ${rowIndex + 1}`}
                    onClick={() => deleteRow(rowIndex)}
                  >
                    <Trash2 className="h-4 w-4 opacity-60 hover:opacity-100" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus />
          Add row
        </Button>
      </div>
    </div>
  )
}
