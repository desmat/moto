import { del } from "@vercel/blob";
import { createStore } from "./stores";
import { Attachment } from "@/types/Attachment";
import { SessionUser } from "@/types/User";

const store = createStore({
  debug: true,
});

export async function getAttachments(query?: any): Promise<any> {
  console.log("services.attachments.getAttachments", { query });

  return store.attachments.find(query);
}

export async function getAttachment(id: string): Promise<Attachment | undefined> {
  console.log("services.attachments.getAttachment", { id });

  return store.attachments.get(id);
}

export async function saveAttachment(attachment: any, by: SessionUser): Promise<Attachment | undefined> {
  console.log("services.attachments.saveAttachment", { attachment, by });

  if (attachment.id && await store.attachments.exists(attachment.id)) {
    return store.attachments.update({ ...attachment, updatedBy: by.id });
  } else {
    return store.attachments.create({ ...attachment, userId: attachment.userId || by.id, createdBy: by.id });
  }
}

export async function deleteAttachment(id: string): Promise<Attachment | undefined> {
  console.log("services.attachments.deleteAttachment", { id });

  const attachment = await store.attachments.get(id);

  // best-effort blob deletion: fake pathnames (tests, memory-store dev) or an already-
  // deleted blob must not block deleting the record; an orphaned blob is a cost leak,
  // not a correctness bug
  try {
    attachment && await del(attachment.url);
  } catch (e) {
    console.warn("services.attachments.deleteAttachment: blob deletion failed (continuing with record deletion)", { id, url: attachment?.url, error: e });
  }

  return store.attachments.delete(id);
}
