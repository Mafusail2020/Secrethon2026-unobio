import { ApiError } from "../../api/client";
import { friendlyMessage } from "../../lib/errors";

export function ErrorBox({ error, title = "Something went wrong" }: { error: unknown; title?: string }) {
  const message = friendlyMessage(error);
  const details = error instanceof ApiError ? error.details : [];
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <div className="font-medium">{title}</div>
      <div>{message}</div>
      {details.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {details.map((d) => (
            <li key={`${d.path}:${d.message}`}>
              <code>{d.path}</code>: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
