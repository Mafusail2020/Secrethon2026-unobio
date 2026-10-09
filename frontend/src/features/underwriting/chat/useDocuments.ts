import { useCallback, useRef, useState } from "react";
import { getApi } from "../../../api/client";
import type { DocumentInfo } from "../../../api/types";
import { friendlyMessage } from "../../../lib/errors";
import { whyNot } from "./documents";

/** The files attached to the run being written: uploaded one at a time, each named back by its id. */
export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [uploading, setUploading] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  // what is held or on its way, so two quick drops cannot both pass the limit
  const claimed = useRef<{ name: string }[]>([]);
  // ids are made from the file's bytes, so the same content under another name arrives as the same id
  const ids = useRef(new Set<string>());

  const add = useCallback(async (files: File[]) => {
    const rejected: string[] = [];
    for (const file of files) {
      const reason = whyNot(file, claimed.current);
      if (reason) {
        rejected.push(reason);
        continue;
      }
      claimed.current = [...claimed.current, { name: file.name }];
      setUploading((u) => [...u, file.name]);
      try {
        const info = await (await getApi()).uploadDocument(file);
        if (ids.current.has(info.id)) {
          claimed.current = claimed.current.filter((c) => c.name !== file.name);
          rejected.push(`${file.name} has the same content as a file already added.`);
        } else {
          ids.current.add(info.id);
          setDocuments((d) => [...d, info]);
        }
      } catch (error) {
        claimed.current = claimed.current.filter((c) => c.name !== file.name);
        rejected.push(`${file.name}: ${friendlyMessage(error)}`);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
    setProblems(rejected);
  }, []);

  const remove = useCallback((id: string) => {
    ids.current.delete(id);
    setDocuments((d) => {
      claimed.current = d.filter((x) => x.id !== id).map((x) => ({ name: x.name }));
      return d.filter((x) => x.id !== id);
    });
    setProblems([]);
  }, []);

  return { documents, uploading, problems, add, remove };
}
