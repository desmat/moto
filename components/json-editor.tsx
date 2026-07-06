'use client'
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

// Bare-bones entity detail editor: shows the record's full JSON, nicely formatted, and
// lets the user edit and save it directly. Server routes pin identity fields (id, userId,
// createdAt) so those can't actually be changed even if edited here.
export default function JsonEditor({
  title,
  value,
  saving,
  onSave,
  onDelete,
  onBack,
}: {
  title: string,
  value: any,
  saving?: boolean,
  onSave?: (value: any) => void,
  onDelete?: () => void,
  onBack?: () => void,
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const original = value ? JSON.stringify(value, null, 2) : "";

  useEffect(() => {
    setText(original);
    setError("");
  }, [original]);

  const handleChange = (newText: string) => {
    setText(newText);

    try {
      JSON.parse(newText);
      setError("");
    } catch (e: any) {
      setError(`${e.message || e}`);
    }
  };

  const handleSave = () => {
    try {
      onSave && onSave(JSON.parse(text));
    } catch (e: any) {
      setError(`${e.message || e}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 items-center w-full max-w-[800px]">
      <div className="font-semibold capitalize">
        {title}
      </div>
      <Textarea
        className="w-full h-[24rem] font-mono text-sm whitespace-pre"
        value={text}
        disabled={!value || saving}
        onChange={(e) => handleChange(e.target.value)}
      />
      {error &&
        <div className="text-sm text-[hsl(var(--destructive))]">{error}</div>
      }
      <div className="flex flex-row gap-2 my-1">
        {onBack &&
          <Button variant="link" onClick={onBack}>(Back)</Button>
        }
        {onDelete &&
          <Button variant="destructive" onClick={onDelete} disabled={!value || saving}>Delete</Button>
        }
        {onSave &&
          <Button onClick={handleSave} disabled={!value || saving || !!error || text == original}>Save</Button>
        }
      </div>
    </div>
  )
}
