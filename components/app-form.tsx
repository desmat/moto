import { listToMap } from "@desmat/utils";
import { capitalize } from "@desmat/utils/format";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import moment from "moment";
import { z } from "zod"
import { Button } from "@/components/ui/button";
import {
  Form as UI_Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function dataToFormFields(data: any, order: string[] = []) {
  const formFields = listToMap(
    Object.entries(data)
      .sort()
      .map(([k, v]: any) => [
        k,
        {
          label: k,
          value: v,
        }
      ]),
    {
      keyFn: (e: any) => e[0],
      valFn: (e: any) => e[1],
    }
  );

  const orderedFormFields = listToMap(
    order
      .map((key: string) => {
        const field = formFields[key];
        if (field) {
          return [
            key,
            { ...field }
          ]
        }
      })
      .filter(Boolean),
    {
      keyFn: (e: any) => e[0],
      valFn: (e: any) => e[1],
    }
  );

  return { ...orderedFormFields, ...formFields };
};

export default function Form({
  title,
  fields,
}: {
  title?: string,
  fields: any,
}) {
  // console.log("components.Form.Form", { title, fields });
  // if (edit) return <EditForm title={title} fields={fields} />

  return (
    <div className="_bg-yelow-200 flex flex-col justify-center items-center gap-1 _md:w-full w-fit max-w-[800px]">
      {title &&
        <div className="font-semibold capitalize mb-3">
          {title}
        </div>
      }
      {Object.entries(fields).map(([k, v]: any, i) => (
        <div key={i}>
          {v.label &&
            <div
              className="_bg-yellow-200 grid grid-cols-1 md:grid-cols-4 md:gap-3 gap-0 items-baseline self-start md:w-full w-fit"
              key={`form-entry-${k}`}
            >
              <div
                className="_bg-purple-200 opacity-40 md:text-right md:self-center text-left _capitalize _truncate"
                title={v.label}
              >
                {v.label}
              </div>
              <div
                className="_bg-blue-200 grid md:col-span-3 text-left md:self-center _truncate break-words md:mt-0 mt-[-0.15rem]"
                title={v.value}
              >
                {
                  v.datatype == "timestamp"
                    ? moment(v.value).format()
                    : v.value
                }
              </div>
            </div>
          }
          {!v.label &&
            <div
              className="_bg-yellow-200 flex flex-col md:flex-row md:gap-3 items-center md:w-full w-fit"
              key={`form-entry-${k}`}
            >
              <div
                className="_bg-blue-200 md:w-[85%] mx-auto _truncate break-words"
                title={v.value}
              >
                {
                  v.datatype == "timestamp"
                    ? moment(v.value).format()
                    : v.value
                }
              </div>
            </div>
          }
        </div>
      ))}
    </div>
  )
}

export function EditForm({
  title,
  fields,
  disabled,
  onCancel,
  onSubmit,
  onDelete,
  onChange,
  submitLabel = "Submit",
}: {
  title?: string,
  fields: any,
  disabled?: boolean,
  onCancel?: () => void,
  onSubmit?: (values: any) => void,
  onDelete?: () => void,
  onChange?: (values: any) => void;
  submitLabel?: string,
}) {
  // console.log("components.app-form.EditForm", { title, fields });
  const formSchema = z.object(listToMap(
    Object.entries(fields)
      .filter(([k, v]: any) => v.editable || v.zod)
      .map(([k, v]: any) => [
        k,
        // @ts-ignore
        v.zod || z[["number"].includes(v.datatype) ? v.datatype : "string"]().min(1, `${capitalize(v.label)} is required`)
      ]),
    {
      keyFn: (e: any) => e[0],
      valFn: (e: any) => e[1],
    }
  ));

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: listToMap(
      Object.entries(fields)
        .filter(([k, v]: any) => (v.editable || v.zod) && v.value)
        .map(([k, v]: any) => [k, v.value]),
      {
        keyFn: (e: any) => e[0],
        valFn: (e: any) => e[1],
      }
    ),
  });

  // console.log("components.app-form.EditForm", { form, isDirty: form.formState.isDirty, dirtyFields: Object.keys(form.formState.dirtyFields) });

  function handleCancel(e?: any) {
    console.log("components.app-form.EditForm.handleCancel");
    e && e.preventDefault();
    onCancel && onCancel();
  }

  function handleSubmit(values: z.infer<typeof formSchema>) {
    console.log("components.app-form.EditForm.handleSubmit", { values });
    // _onSubmit(values);
    onSubmit && onSubmit(values);
  }

  function handleDelete(e: any) {
    console.log("components.app-form.EditForm.handleDelete");
    e.preventDefault();
    if (onDelete) {
      // if (!form.formState.isDirty || confirm("Are you sure?")) {
      onDelete();
      // }
    }
  }

  async function handleKeyDown(e: any) {
    console.log("components.app-form.EditForm.handleKeyDown", { e });
    if (disabled) {
      e.preventDefault();
      return;
    }

    if (e.key == "Escape") {
      e.preventDefault();
      handleCancel();
    } else if (e.key == "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (await form.trigger()) {
        handleSubmit && handleSubmit(form.getValues());
      }
    }
  }

  useEffect(() => {
    document.body.addEventListener('keydown', handleKeyDown);

    Object.entries(fields)
      .filter(([k, v]: any) => (v.editable || v.zod) && v.updated)
      .forEach(([k, v]: any) => {
        // console.log("components.app-form.EditForm useEffect", { [k]: v });
        if (v.updated) {
          form.setValue(k, v.value, {
            shouldValidate: true,
            shouldDirty: true,
            shouldTouch: true,
          });
        }
      });

    const { unsubscribe } = form.watch((value) => {
      // console.log("components.app-form.EditForm useEffect watch", { value });
      onChange && onChange(value);
    });

    return () => {
      document.body.removeEventListener('keydown', handleKeyDown);
      unsubscribe();
    }
  }, [fields]);

  return (
    <UI_Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="_bg-yelow-200 flex flex-col justify-center items-center gap-1 _md:w-full w-fit max-w-[800px]"
      >
        {title &&
          <div className={cn("font-semibold capitalize mb-3", {
            "opacity-40": disabled
          })}>
            {title}
          </div>
        }
        {Object.entries(fields).map(([k, v]: any, i) => (
          <div key={i}>
            {v.label &&
              <div
                className="_bg-yellow-200 col grid grid-cols-1 md:grid-cols-4 md:gap-3 gap-0 items-baseline self-start md:w-full w-fit"
                key={`form-entry-${k}`}
              >
                <div
                  className="_bg-purple-200 opacity-40 md:text-right md:self-center text-left _capitalize _truncate"
                  title={v.label}
                >
                  {v.label}
                </div>

                {!(v.editable || v.zod) &&
                  <>
                    <div
                    className={cn("_bg-blue-200 md:col-span-3 text-left md:self-center break-words w-fit md:mt-0 mt-[-0.15rem]", {
                        "opacity-40": disabled
                      })}
                      title={v.value}
                    >
                      {
                        v.datatype == "timestamp"
                          ? moment(v.value).format()
                          : v.value
                      }
                    </div>
                  </>
                }
                {(v.editable || v.zod) &&
                  <div
                    className={cn("_bg-blue-200 md:col-span-3 text-left md:self-center break-words w-fit", {
                      "opacity-40": disabled
                    })}
                    title={v.value}
                  >
                    <FormField
                      control={form.control}
                      name={k as never}
                      disabled={disabled}
                      render={({ field }) => (
                        <FormItem>
                          {v.datatype == "text" &&
                            <FormControl>
                              <Textarea
                                className="resize-y w-[16rem] h-[6rem]"
                                {...field}
                              />
                            </FormControl>
                          }
                          {v.datatype == "number" &&
                            <FormControl>
                              <Input
                                className="w-[16rem]"
                                type="number"
                                step="0.01"
                                {...field}
                              />
                            </FormControl>
                          }
                          {!["text", "number"].includes(v.datatype) &&
                            <FormControl>
                              <Input
                                className="w-[16rem]"
                                type={v.datatype || "text"}
                                {...field}
                              />
                            </FormControl>
                          }
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                }
              </div >
            }
            {!v.label &&
              <div
                className="_bg-yellow-200 flex flex-col md:flex-row md:gap-3 items-center md:w-full w-fit"
                key={`form-entry-${k}`}
              >
                {!(v.editable || v.zod) &&
                  <div
                    className="_bg-blue-200 md:w-[85%] mx-auto _truncate break-words"
                    title={v.value}
                  >
                    {v.value}
                  </div>
                }
                {(v.editable || v.zod) &&
                  <FormField
                    control={form.control}
                    name={k as never}
                    disabled={disabled}
                    render={({ field }) => (
                      <FormItem>
                        {v.datatype == "text" &&
                          <FormControl>
                            <Textarea
                              className="resize-y w-[16rem] h-[6rem]"
                              {...field}
                            />
                          </FormControl>
                        }
                        {v.datatype != "text" &&
                          <FormControl>
                            <Input
                              className="w-[16rem]"
                              type={v.datatype || "text"}
                              {...field}
                            />
                          </FormControl>
                        }
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                }
              </div>
            }
          </div>
        ))}
        <div className="flex flex-row gap-2 my-3">
          {onCancel && <Button variant="outline" onClick={handleCancel} disabled={disabled}>Cancel</Button>}
          {onDelete && <Button variant="destructive" onClick={handleDelete} disabled={disabled}>Delete</Button>}
          {onSubmit && <Button type="submit" disabled={submitLabel != "Add" && (disabled || !form.formState.isDirty)}>{submitLabel}</Button>}
        </div>
      </form>
    </UI_Form>
  )
}
