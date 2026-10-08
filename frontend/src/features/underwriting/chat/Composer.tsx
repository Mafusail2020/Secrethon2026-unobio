import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getApi } from "../../../api/client";
import { useHealth, useModels } from "../../../api/hooks";
import type { CreateRunRequest, ProgramInput, RunOptions } from "../../../api/types";
import { ErrorBox } from "../../../components/ui/ErrorBox";
import { ArrowUpIcon, PlusIcon } from "../../../components/ui/icons";
import { Spinner } from "../../../components/ui/Spinner";
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

interface EffortOption {
  value: Effort;
  label: string;
  hint: string;
}

const EFFORTS: EffortOption[] = [
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
  "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand aria-[invalid=true]:border-red-400";
const bigInput =
  "uw-bare w-full bg-transparent text-lg placeholder:text-muted/60 aria-[invalid=true]:text-red-700";
const label = "mb-0.5 block text-xs font-medium text-muted";

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

function EffortPicker({ value, onChange }: { value: Effort; onChange: (value: Effort) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">Effort</legend>
      <div className="flex rounded-full bg-slate-100 p-0.5">
        {EFFORTS.map((option) => (
          <label
            key={option.value}
            title={option.hint}
            className={`cursor-pointer rounded-full px-3 py-1 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
              option.value === value ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The big input card of a new chat. Mount with a `key` to refill it from an example. */
export function Composer({ initial }: { initial?: { indication: string; mechanism: string } }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const models = useModels();
  const maxPanel = useHealth().data?.max_panel_size;
  const uid = useId();
  const [form, setForm] = useState<FormState>(() => initialState(initial));
  const [detailsOpen, setDetailsOpen] = useState(false);
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
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      className="rounded-lg border border-line bg-surface shadow-lg shadow-royal/5 transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20"
    >
      <div className="px-5 pt-4">
        <Field id={`${uid}-indication`} name="indication" title="Indication" errors={errors}>
          {(p) => (
            <input
              {...p}
              required
              autoFocus
              className={bigInput}
              value={form.indication}
              onChange={(e) => set("indication", e.target.value)}
              placeholder="Alzheimer's disease"
            />
          )}
        </Field>
      </div>
      <div className="mx-5 mt-2 border-t border-line/70" />
      <div className="px-5 pt-3">
        <Field id={`${uid}-mechanism`} name="mechanism" title="Mechanism or target" errors={errors}>
          {(p) => (
            <input
              {...p}
              required
              className={bigInput}
              value={form.mechanism}
              onChange={(e) => set("mechanism", e.target.value)}
              placeholder="BACE1 inhibition"
            />
          )}
        </Field>
      </div>

      {detailsOpen && (
        <div id={`${uid}-details`} className="mx-3 mt-3 grid grid-cols-2 gap-2 rounded-lg border border-line/70 p-3">
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
      )}

      {general && (
        <div className="px-4 pt-3">
          <ErrorBox error={new Error(general)} title="Could not start the run" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-3">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          aria-controls={`${uid}-details`}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:border-brand hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <PlusIcon width={15} height={15} strokeWidth={2.2} className={detailsOpen ? "rotate-45 transition-transform" : "transition-transform"} />
          Add details
        </button>
        <EffortPicker value={form.effort} onChange={(v) => set("effort", v)} />
        {form.effort === "panel" && (
          <div className="flex items-center gap-1.5">
            <Field id={`${uid}-panel`} name="panel_size" title="Panel size" errors={errors}>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  min={2}
                  max={maxPanel}
                  title={maxPanel ? `Between 2 and ${maxPanel}` : undefined}
                  className={`${input} w-20`}
                  value={form.panel_size}
                  onChange={(e) => set("panel_size", Number(e.target.value))}
                />
              )}
            </Field>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <select
            aria-label="Model"
            className="max-w-[11rem] truncate rounded-full bg-transparent py-1.5 pl-2 pr-1 text-sm text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
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
          <button
            type="submit"
            aria-label="Underwrite"
            title="Underwrite (⌘ Enter)"
            disabled={create.isPending}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-royal text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
          >
            {create.isPending ? <Spinner className="h-4 w-4" /> : <ArrowUpIcon />}
          </button>
        </div>
      </div>

      {models.isError && (
        <p className="px-5 pb-3 text-xs text-amber-700">Could not load the model list; the cheapest available model will be used.</p>
      )}
    </form>
  );
}
