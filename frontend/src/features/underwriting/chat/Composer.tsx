import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getApi } from "../../../api/client";
import { useHealth, useModels } from "../../../api/hooks";
import type { CreateRunRequest, ProgramInput, RunOptions } from "../../../api/types";
import { Badge } from "../../../components/ui/Badge";
import { ErrorBox } from "../../../components/ui/ErrorBox";
import { Segmented, type SegmentOption } from "../../../components/ui/Segmented";
import { Spinner } from "../../../components/ui/Spinner";
import { priceLabel } from "../../../lib/format";
import { readPref, writePref } from "../../../lib/storage";
import { fieldErrors } from "./fieldErrors";

const MODALITIES = [
  "small_molecule",
  "antibody",
  "biologic_other",
  "cell_therapy",
  "gene_therapy",
  "oligonucleotide",
  "vaccine",
  "other",
] as const;
const STAGES = [
  "discovery",
  "preclinical",
  "ind_enabling",
  "phase1",
  "phase2",
  "phase3",
  "filed",
  "approved",
] as const;

type Effort = NonNullable<RunOptions["effort"]>;

const EFFORTS: SegmentOption<Effort>[] = [
  { value: "low", label: "Low", hint: "Quick pass: fewer sources and queries." },
  { value: "medium", label: "Medium", hint: "Balanced default." },
  { value: "high", label: "High", hint: "Deeper retrieval, and a stronger model tier when one is available." },
  {
    value: "panel",
    label: "Panel",
    hint: "Several models analyse independently, then one call compares them.",
  },
];

const PREF_EFFORT = "uw.effort";
const PREF_MODEL = "uw.model";

interface FormState {
  indication: string;
  mechanism: string;
  drug_name: string;
  modality: string;
  stage: string;
  preclinical_results: string;
  biomarkers: string;
  route: string;
  notes: string;
  links: string;
  effort: Effort;
  model: string;
  panel_size: number;
}

function initialState(initial?: { indication: string; mechanism: string }): FormState {
  const stored = readPref(PREF_EFFORT);
  return {
    indication: initial?.indication ?? "",
    mechanism: initial?.mechanism ?? "",
    drug_name: "",
    modality: "",
    stage: "",
    preclinical_results: "",
    biomarkers: "",
    route: "",
    notes: "",
    links: "",
    effort: EFFORTS.some((e) => e.value === stored) ? (stored as Effort) : "medium",
    model: readPref(PREF_MODEL) ?? "",
    panel_size: 3,
  };
}

const blankToUndefined = (value: string) => value.trim() || undefined;

function toRequest(form: FormState): CreateRunRequest {
  const program: ProgramInput = {
    indication: form.indication.trim(),
    mechanism: form.mechanism.trim(),
    drug_name: blankToUndefined(form.drug_name),
    modality: (form.modality || undefined) as ProgramInput["modality"],
    stage: (form.stage || undefined) as ProgramInput["stage"],
    preclinical_results: blankToUndefined(form.preclinical_results),
    biomarkers: blankToUndefined(form.biomarkers),
    route: blankToUndefined(form.route),
    notes: blankToUndefined(form.notes),
    links: form.links
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  };
  const options: RunOptions = {
    effort: form.effort,
    model: form.model || undefined,
    ...(form.effort === "panel" ? { panel_size: form.panel_size } : {}),
  };
  return { program, options };
}

const input =
  "w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm placeholder:text-muted/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand aria-[invalid=true]:border-red-400";
const label = "mb-1 block text-xs font-medium text-muted";

function Field({
  id,
  name,
  title,
  errors,
  children,
}: {
  id: string;
  name: string;
  title: string;
  errors: Record<string, string>;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const error = errors[name];
  return (
    <div>
      <label className={label} htmlFor={id}>
        {title}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": error ? `${id}-error` : undefined })}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Chat-style input card. Mount with a `key` to refill it from an example. */
export function Composer({ initial }: { initial?: { indication: string; mechanism: string } }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const models = useModels();
  const maxPanel = useHealth().data?.max_panel_size;
  const uid = useId();
  const [form, setForm] = useState<FormState>(() => initialState(initial));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: async (body: CreateRunRequest) => (await getApi()).createRun(body),
    onSuccess: (run) => {
      writePref(PREF_EFFORT, form.effort);
      writePref(PREF_MODEL, form.model);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/underwriting/runs/${run.id}`);
    },
  });

  const { fields: errors, general } = create.error ? fieldErrors(create.error) : { fields: {}, general: undefined };
  const list = models.data ?? [];
  const chosen = list.find((m) => m.id === form.model) ?? list.find((m) => m.default);
  // a remembered model that is gone or unavailable falls back to the default
  const modelValue = list.some((m) => m.id === form.model && m.available) ? form.model : "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(toRequest({ ...form, model: modelValue }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="space-y-3 rounded-xl border border-line bg-white p-3 shadow-sm">
      <Field id={`${uid}-indication`} name="indication" title="Indication" errors={errors}>
        {(p) => (
          <input
            {...p}
            required
            autoFocus
            className={input}
            value={form.indication}
            onChange={(e) => set("indication", e.target.value)}
            placeholder="Alzheimer's disease"
          />
        )}
      </Field>
      <Field id={`${uid}-mechanism`} name="mechanism" title="Mechanism or target" errors={errors}>
        {(p) => (
          <input
            {...p}
            required
            className={input}
            value={form.mechanism}
            onChange={(e) => set("mechanism", e.target.value)}
            placeholder="BACE1 inhibition"
          />
        )}
      </Field>

      <details className="group rounded-md border border-line">
        <summary className="cursor-pointer select-none px-2.5 py-1.5 text-sm text-muted group-open:text-ink">
          Add details
        </summary>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-2.5">
          <Field id={`${uid}-drug`} name="drug_name" title="Drug name" errors={errors}>
            {(p) => <input {...p} className={input} value={form.drug_name} onChange={(e) => set("drug_name", e.target.value)} />}
          </Field>
          <Field id={`${uid}-route`} name="route" title="Route" errors={errors}>
            {(p) => <input {...p} className={input} value={form.route} onChange={(e) => set("route", e.target.value)} />}
          </Field>
          <Field id={`${uid}-modality`} name="modality" title="Modality" errors={errors}>
            {(p) => (
              <select {...p} className={input} value={form.modality} onChange={(e) => set("modality", e.target.value)}>
                <option value="">unspecified</option>
                {MODALITIES.map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${uid}-stage`} name="stage" title="Stage" errors={errors}>
            {(p) => (
              <select {...p} className={input} value={form.stage} onChange={(e) => set("stage", e.target.value)}>
                <option value="">unspecified</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="col-span-2">
            <Field id={`${uid}-biomarkers`} name="biomarkers" title="Biomarkers" errors={errors}>
              {(p) => <input {...p} className={input} value={form.biomarkers} onChange={(e) => set("biomarkers", e.target.value)} />}
            </Field>
          </div>
          <div className="col-span-2">
            <Field id={`${uid}-preclinical`} name="preclinical_results" title="Preclinical results" errors={errors}>
              {(p) => <textarea {...p} rows={2} className={input} value={form.preclinical_results} onChange={(e) => set("preclinical_results", e.target.value)} />}
            </Field>
          </div>
          <div className="col-span-2">
            <Field id={`${uid}-notes`} name="notes" title="Notes" errors={errors}>
              {(p) => <textarea {...p} rows={2} className={input} value={form.notes} onChange={(e) => set("notes", e.target.value)} />}
            </Field>
          </div>
          <div className="col-span-2">
            <Field id={`${uid}-links`} name="links" title="Links (one per line)" errors={errors}>
              {(p) => <textarea {...p} rows={2} className={input} value={form.links} onChange={(e) => set("links", e.target.value)} />}
            </Field>
          </div>
        </div>
      </details>

      <Segmented label="Effort" options={EFFORTS} value={form.effort} onChange={(v) => set("effort", v)} />

      {form.effort === "panel" && (
        <Field id={`${uid}-panel`} name="panel_size" title="Panel size" errors={errors}>
          {(p) => (
            <input
              {...p}
              type="number"
              min={2}
              max={maxPanel}
              title={maxPanel ? `Between 2 and ${maxPanel}` : undefined}
              className={`${input} w-24`}
              value={form.panel_size}
              onChange={(e) => set("panel_size", Number(e.target.value))}
            />
          )}
        </Field>
      )}

      <div>
        <label className={label} htmlFor={`${uid}-model`}>
          Model
        </label>
        <select
          id={`${uid}-model`}
          className={input}
          value={modelValue}
          onChange={(e) => set("model", e.target.value)}
        >
          <option value="">Cheapest available</option>
          {list.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available}>
              {m.label}
              {m.available ? "" : " (unavailable)"}
            </option>
          ))}
        </select>
        {models.isError && <p className="mt-1 text-xs text-amber-700">Could not load the model list; the cheapest available model will be used.</p>}
        {chosen && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Badge className="border-line text-muted">{chosen.tier}</Badge>
            {priceLabel(chosen.price_in_per_mtok, chosen.price_out_per_mtok)}
          </p>
        )}
      </div>

      {general && <ErrorBox error={new Error(general)} title="Could not start the run" />}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">
          <kbd className="rounded border border-line px-1">⌘</kbd>
          <kbd className="ml-0.5 rounded border border-line px-1">Enter</kbd> to run
        </span>
        <button
          type="submit"
          disabled={create.isPending}
          className="inline-flex items-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
        >
          {create.isPending && <Spinner className="h-3 w-3" />}
          Underwrite
        </button>
      </div>
    </form>
  );
}
